/**
 * Unit tests for the Convex-backed user-state adapter
 * (packages/kody-chat user-state Convex adapter): userState get/save
 * with the right tenantId, namespace, and userKey, plus caching.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { z } from "zod";

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

import {
  _resetUserStateDocCache,
  convexUserStateAdapter,
} from "@kody-ade/kody-chat-dashboard/user-state/adapters/convex";
import { userFileKey } from "@kody-ade/kody-chat-dashboard/user-state/user-key";
import type {
  UserStateDoc,
  UserStateNamespace,
} from "@kody-ade/kody-chat-dashboard/user-state/types";

const NAMESPACE: UserStateNamespace = {
  name: "profile",
  version: 1,
  origin: "core",
  schema: z.object({}).passthrough(),
  adapter: "convex",
  merge: "shallow-merge",
  modelWritable: true,
};

const CTX = { octokit: {} as never, owner: "acme", repo: "widgets" };
const USER_ID = "github:alice";
const USER_KEY = userFileKey(USER_ID);

beforeEach(() => {
  vi.clearAllMocks();
  _resetUserStateDocCache();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("user-state convex adapter", () => {
  it("gets a doc via userState.get with tenant/namespace/userKey", async () => {
    convex.query.mockResolvedValue({
      data: { locale: "he" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const doc = await convexUserStateAdapter.get(CTX, USER_ID, NAMESPACE);

    expect(doc).toEqual({
      version: 1,
      namespace: "profile",
      userId: USER_ID,
      updatedAt: "2026-07-01T00:00:00.000Z",
      data: { locale: "he" },
      revision: "2026-07-01T00:00:00.000Z",
    });
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("userState:get");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      namespace: "profile",
      userKey: USER_KEY,
    });
  });

  it("returns null for missing docs and caches reads", async () => {
    convex.query.mockResolvedValue(null);

    expect(
      await convexUserStateAdapter.get(CTX, USER_ID, NAMESPACE),
    ).toBeNull();
    expect(
      await convexUserStateAdapter.get(CTX, USER_ID, NAMESPACE),
    ).toBeNull();
    expect(convex.query).toHaveBeenCalledTimes(1);
  });

  it("saves via userState.save and invalidates the cache", async () => {
    convex.query.mockResolvedValue({
      data: { locale: "he" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    convex.mutation.mockResolvedValue("id-1");
    await convexUserStateAdapter.get(CTX, USER_ID, NAMESPACE);

    const doc: UserStateDoc = {
      version: 1,
      namespace: "profile",
      userId: USER_ID,
      updatedAt: "2026-07-02T00:00:00.000Z",
      data: { locale: "en" },
    };
    await convexUserStateAdapter.set(CTX, USER_ID, NAMESPACE, doc);

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("userState:save");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      namespace: "profile",
      userKey: USER_KEY,
      data: { locale: "en" },
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    await convexUserStateAdapter.get(CTX, USER_ID, NAMESPACE);
    expect(convex.query).toHaveBeenCalledTimes(2);
  });
});
