/**
 * Unit tests for fetchCompanyActivity (src/github/status.ts) on the Convex
 * backend: dailyLogs.recent (stream "activity") rows → CompanyActivityRecord
 * list, newest-first, with an in-process cache and error fallback to [].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

vi.mock("@kody-ade/base/github/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/github/core")>();
  return {
    ...actual,
    getOwner: () => "acme",
    getRepo: () => "widgets",
    getOctokit: () => ({}) as never,
  };
});

import { _resetConvexClient } from "@kody-ade/base/backend/convex";
import { fetchCompanyActivity } from "../../src/github/status";

function entry(ts: string, capability: string) {
  return {
    entry: {
      ts,
      capability,
      action: `Ran capability: ${capability}`,
      trigger: "schedule",
      outcome: "completed",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("fetchCompanyActivity (convex)", () => {
  it("queries dailyLogs.recent for the activity stream and sorts newest-first", async () => {
    convex.query.mockResolvedValue([
      entry("2026-07-14T10:00:00Z", "older"),
      entry("2026-07-15T10:00:00Z", "newer"),
    ]);

    const records = await fetchCompanyActivity(7);

    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("dailyLogs:recent");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      stream: "activity",
      limit: 7,
    });
    expect(records.map((r) => r.capability)).toEqual(["newer", "older"]);
  });

  it("skips malformed entries", async () => {
    convex.query.mockResolvedValue([
      { entry: { nope: true } },
      entry("2026-07-15T10:00:00Z", "ok"),
    ]);
    const records = await fetchCompanyActivity(11);
    expect(records.map((r) => r.capability)).toEqual(["ok"]);
  });

  it("serves the in-process cache on repeat calls", async () => {
    convex.query.mockResolvedValue([entry("2026-07-15T10:00:00Z", "x")]);
    await fetchCompanyActivity(13);
    await fetchCompanyActivity(13);
    expect(convex.query).toHaveBeenCalledTimes(1);
  });

  it("returns [] when the backend errors with no stale data", async () => {
    convex.query.mockRejectedValue(new Error("down"));
    expect(await fetchCompanyActivity(17)).toEqual([]);
  });
});
