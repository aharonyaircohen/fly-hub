/**
 * Unit tests for the Convex-backed Fly activity store
 * (src/plugin/runners/activity-store.ts): dailyLogs stream "flyActivity"
 * rows → FlyActivityFile (windowed, oldest-first), throttled snapshot
 * recording, and inventory → snapshot mapping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/base/backend/convex", () => ({
  getConvexClient: () => convex,
  tenantIdFor: (owner: string, repo: string) => `${owner}/${repo}`,
  backendApi: new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => "fn-ref" }) },
  ),
}));

import {
  readActivityFile,
  recordSnapshot,
  snapshotDue,
  snapshotFromInventory,
} from "../../src/plugin/runners/activity-store";
import type {
  ActivitySnapshot,
  FlyActivityFile,
} from "../../src/plugin/runners/activity";

const octokit = {} as Octokit;

function snap(ts: number): ActivitySnapshot {
  return {
    ts,
    machines: [
      { app: "app-a", machineId: "m1", state: "started", cpus: 1 },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readActivityFile", () => {
  it("queries dailyLogs.recent (flyActivity) scoped to the tenant", async () => {
    convex.query.mockResolvedValue([]);
    await readActivityFile(octokit, "acme", "widgets");
    expect(convex.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/widgets",
      stream: "flyActivity",
      limit: 1000,
    });
  });

  it("returns snapshots oldest-first within the 14-day window", async () => {
    const now = Date.now();
    const fresh1 = snap(now - 60_000);
    const fresh2 = snap(now - 30_000);
    const stale = snap(now - 15 * 24 * 60 * 60_000);
    convex.query.mockResolvedValue([
      { entry: fresh2 },
      { entry: fresh1 },
      { entry: stale },
    ]);
    const file = await readActivityFile(octokit, "acme", "widgets");
    expect(file.snapshots.map((s) => s.ts)).toEqual([fresh1.ts, fresh2.ts]);
  });

  it("drops malformed rows and returns the empty file when nothing is valid", async () => {
    convex.query.mockResolvedValue([
      { entry: null },
      { entry: { ts: "nope" } },
      {},
    ]);
    const file = await readActivityFile(octokit, "acme", "widgets");
    expect(file).toEqual({ version: 1, snapshots: [] });
  });

  it("propagates backend errors (route treats them as 500)", async () => {
    convex.query.mockRejectedValue(new Error("convex down"));
    await expect(readActivityFile(octokit, "acme", "widgets")).rejects.toThrow(
      "convex down",
    );
  });
});

describe("recordSnapshot", () => {
  it("appends a dailyLogs row keyed by the snapshot's UTC date", async () => {
    convex.query.mockResolvedValue([]);
    convex.mutation.mockResolvedValue("id1");
    const snapshot = snap(Date.UTC(2026, 6, 16, 10, 0, 0));
    const res = await recordSnapshot(octokit, "acme", "widgets", snapshot);
    expect(res).toEqual({ recorded: true });
    expect(convex.mutation).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/widgets",
      stream: "flyActivity",
      date: "2026-07-16",
      entry: snapshot,
    });
  });

  it("throttles when the newest snapshot is under 5 minutes old", async () => {
    const now = Date.now();
    convex.query.mockResolvedValue([{ entry: snap(now - 2 * 60_000) }]);
    const res = await recordSnapshot(octokit, "acme", "widgets", snap(now));
    expect(res).toEqual({ recorded: false });
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("records when the newest snapshot is older than the throttle", async () => {
    const now = Date.now();
    convex.query.mockResolvedValue([{ entry: snap(now - 6 * 60_000) }]);
    convex.mutation.mockResolvedValue("id2");
    const res = await recordSnapshot(octokit, "acme", "widgets", snap(now));
    expect(res).toEqual({ recorded: true });
  });
});

describe("snapshotDue", () => {
  it("is true for an empty file and false right after a snapshot", () => {
    const now = Date.now();
    const empty: FlyActivityFile = { version: 1, snapshots: [] };
    expect(snapshotDue(empty, now)).toBe(true);
    const recent: FlyActivityFile = {
      version: 1,
      snapshots: [snap(now - 60_000)],
    };
    expect(snapshotDue(recent, now)).toBe(false);
    const old: FlyActivityFile = {
      version: 1,
      snapshots: [snap(now - 10 * 60_000)],
    };
    expect(snapshotDue(old, now)).toBe(true);
  });
});

describe("snapshotFromInventory", () => {
  it("keeps only the fields the activity compute needs", () => {
    const inv = {
      machines: [
        {
          app: "app-a",
          machineId: "m1",
          state: "started",
          region: "fra",
          guest: { cpuKind: "shared", cpus: 2, memoryMb: 2048 },
        },
      ],
    } as never;
    expect(snapshotFromInventory(inv, 123)).toEqual({
      ts: 123,
      machines: [
        {
          app: "app-a",
          machineId: "m1",
          state: "started",
          cpuKind: "shared",
          cpus: 2,
          memoryMb: 2048,
        },
      ],
    });
  });
});
