/**
 * Unit tests for the Convex-backed notification preferences store
 * (src/dashboard/lib/notifications/prefs-store.ts): notificationPrefs
 * get/save with the right tenantId + lowercase login, caching, and
 * fail-open defaults.
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

const h = vi.hoisted(() => ({
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: h.getOwner,
  getRepo: h.getRepo,
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  DEFAULT_NOTIFICATION_PREFS,
  _resetPrefsCache,
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefsFile,
} from "@dashboard/lib/notifications/prefs-store";

const PREFS: NotificationPrefsFile = {
  version: 1,
  mutedTypes: ["pr-merged"],
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  _resetPrefsCache();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("readNotificationPrefs", () => {
  it("queries notificationPrefs.get with tenantId and lowercase login", async () => {
    convex.query.mockResolvedValue({ prefs: PREFS });

    const prefs = await readNotificationPrefs("Alice");

    expect(prefs).toEqual(PREFS);
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("notificationPrefs:get");
    expect(args).toEqual({ tenantId: "acme/widgets", login: "alice" });
  });

  it("returns defaults when no doc exists", async () => {
    convex.query.mockResolvedValue(null);
    const prefs = await readNotificationPrefs("alice");
    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("fails open with defaults on backend errors", async () => {
    convex.query.mockRejectedValue(new Error("backend down"));
    const prefs = await readNotificationPrefs("alice");
    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("normalizes malformed docs to a safe shape", async () => {
    convex.query.mockResolvedValue({ prefs: { mutedTypes: "nope" } });
    const prefs = await readNotificationPrefs("alice");
    expect(prefs).toEqual({ version: 1, mutedTypes: [] });
  });

  it("serves repeat reads from cache", async () => {
    convex.query.mockResolvedValue({ prefs: PREFS });
    await readNotificationPrefs("alice");
    await readNotificationPrefs("ALICE");
    expect(convex.query).toHaveBeenCalledTimes(1);
  });
});

describe("writeNotificationPrefs", () => {
  it("saves via notificationPrefs.save with the doc shape", async () => {
    convex.mutation.mockResolvedValue("id-1");

    await writeNotificationPrefs("Alice", PREFS);

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("notificationPrefs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      login: "alice",
      prefs: PREFS,
    });
    expect(typeof (args as { updatedAt: string }).updatedAt).toBe("string");
  });

  it("invalidates the read cache so the next read re-queries", async () => {
    convex.query.mockResolvedValue({ prefs: PREFS });
    await readNotificationPrefs("alice");
    convex.mutation.mockResolvedValue("id-1");
    await writeNotificationPrefs("alice", PREFS);
    await readNotificationPrefs("alice");
    expect(convex.query).toHaveBeenCalledTimes(2);
  });

  it("propagates backend write failures", async () => {
    convex.mutation.mockRejectedValue(new Error("write failed"));
    await expect(
      writeNotificationPrefs("alice", PREFS),
    ).rejects.toThrow("write failed");
  });
});
