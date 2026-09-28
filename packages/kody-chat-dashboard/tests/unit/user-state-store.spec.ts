/**
 * Unit tests for the Convex user-state adapter and stable user keys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/backend/api", () => ({
  api: {
    userState: {
      get: "userState:get",
      save: "userState:save",
    },
  },
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: h.query,
    mutation: h.mutation,
  }),
}));

import { userFileKey } from "../../src/dashboard/lib/user-state/user-key";
import {
  convexUserStateAdapter,
  _resetUserStateDocCache,
} from "../../src/dashboard/lib/user-state/adapters/convex";
import { CORE_USER_STATE_NAMESPACES } from "../../src/dashboard/lib/user-state/namespaces/core";
import type { UserStateDoc } from "../../src/dashboard/lib/user-state/types";

const ctx = { octokit: {} as Octokit, owner: "acme", repo: "shop" };
const selections = CORE_USER_STATE_NAMESPACES.find(
  (namespace) => namespace.name === "selections",
)!;
const USER = "client:jane@example.com";

function doc(data: Record<string, unknown>): UserStateDoc {
  return {
    version: 1,
    namespace: "selections",
    userId: USER,
    updatedAt: "2026-07-11T00:00:00.000Z",
    data,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetUserStateDocCache();
});

describe("userFileKey", () => {
  it("sanitizes and appends a stable hash suffix", () => {
    const key = userFileKey(USER);
    expect(key).toMatch(/^client-jane-example-com-[0-9a-f]{8}$/);
    expect(userFileKey(USER)).toBe(key);
  });

  it("keeps ids distinct when their sanitized prefixes match", () => {
    expect(userFileKey("client:a.b@x.io")).not.toBe(
      userFileKey("client:a-b@x.io"),
    );
  });
});

describe("convexUserStateAdapter", () => {
  it("reads a tenant-scoped user document", async () => {
    h.query.mockResolvedValue({
      data: { theme: "dark" },
      updatedAt: "2026-07-11T00:00:00.000Z",
    });

    const result = await convexUserStateAdapter.get(ctx, USER, selections);

    expect(result).toMatchObject({
      namespace: "selections",
      userId: USER,
      data: { theme: "dark" },
      revision: "2026-07-11T00:00:00.000Z",
    });
    expect(h.query).toHaveBeenCalledWith("userState:get", {
      tenantId: "acme/shop",
      namespace: "selections",
      userKey: userFileKey(USER),
    });
  });

  it("returns null for a missing document", async () => {
    h.query.mockResolvedValue(null);
    await expect(
      convexUserStateAdapter.get(ctx, USER, selections),
    ).resolves.toBeNull();
  });

  it("uses the read cache until a write invalidates it", async () => {
    h.query.mockResolvedValue({
      data: { theme: "dark" },
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    await convexUserStateAdapter.get(ctx, USER, selections);
    await convexUserStateAdapter.get(ctx, USER, selections);
    expect(h.query).toHaveBeenCalledTimes(1);

    h.mutation.mockResolvedValue(undefined);
    await convexUserStateAdapter.set(
      ctx,
      USER,
      selections,
      doc({ theme: "light" }),
    );
    await convexUserStateAdapter.get(ctx, USER, selections);
    expect(h.query).toHaveBeenCalledTimes(2);
  });

  it("writes through the Convex backend contract", async () => {
    h.mutation.mockResolvedValue(undefined);

    await convexUserStateAdapter.set(
      ctx,
      USER,
      selections,
      doc({ theme: "dark" }),
    );

    expect(h.mutation).toHaveBeenCalledWith("userState:save", {
      tenantId: "acme/shop",
      namespace: "selections",
      userKey: userFileKey(USER),
      data: { theme: "dark" },
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
  });

  it("forwards the CAS token when the caller passes an expected revision", async () => {
    h.mutation.mockResolvedValue(undefined);

    await convexUserStateAdapter.set(
      ctx,
      USER,
      selections,
      doc({ theme: "dark" }),
      { expectedRevision: "rev-1" },
    );

    expect(h.mutation).toHaveBeenCalledWith(
      "userState:save",
      expect.objectContaining({ expectedUpdatedAt: "rev-1" }),
    );
  });
});
