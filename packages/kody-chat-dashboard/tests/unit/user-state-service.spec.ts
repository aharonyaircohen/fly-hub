/**
 * Unit tests for the user-state service
 * (src/dashboard/lib/user-state/service.ts): merge policies, schema
 * rejection with typed errors, and `state.entity.written` emission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  emitSystemEvent: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: h.query,
    mutation: h.mutation,
  }),
}));
vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));
vi.mock("@kody-ade/base/events", () => ({
  emitSystemEvent: h.emitSystemEvent,
}));

import { getUserState, setUserState } from "../../src/dashboard/lib/user-state/service";
import { _resetUserStateConfigCache } from "../../src/dashboard/lib/user-state/config";
import { _resetUserStateDocCache } from "../../src/dashboard/lib/user-state/adapters/convex";
import { UserStateError } from "../../src/dashboard/lib/user-state/types";

const ctx = {
  octokit: {} as Octokit,
  owner: "acme",
  repo: "shop",
  userId: "client:jane@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetUserStateConfigCache();
  _resetUserStateDocCache();
  h.query.mockResolvedValue(null);
  h.mutation.mockResolvedValue(undefined);
});

describe("getUserState", () => {
  it("throws a typed 404 for unknown namespaces", async () => {
    await expect(getUserState(ctx, "nope")).rejects.toMatchObject({
      code: "namespace_not_found",
      status: 404,
    });
  });

  it("returns null when the user has no document", async () => {
    expect(await getUserState(ctx, "selections")).toBeNull();
  });
});

describe("setUserState", () => {
  it("writes a validated doc and emits state.entity.written", async () => {
    const doc = await setUserState(
      ctx,
      "selections",
      { theme: "dark" },
      { source: "model" },
    );

    expect(doc.namespace).toBe("selections");
    expect(doc.userId).toBe(ctx.userId);
    expect(doc.data).toEqual({ theme: "dark" });
    expect(h.mutation).toHaveBeenCalledTimes(1);
    expect(h.emitSystemEvent).toHaveBeenCalledWith(
      "state.entity.written",
      expect.objectContaining({
        namespace: "selections",
        namespaceVersion: 1,
        keys: ["theme"],
        source: "model",
      }),
      expect.objectContaining({
        userId: ctx.userId,
        brand: { owner: "acme", repo: "shop" },
        source: "model",
      }),
    );
  });

  it("shallow-merges with the existing document", async () => {
    h.query.mockImplementation(async (_fn, args: Record<string, unknown>) =>
      args.namespace === "selections"
        ? {
            data: { theme: "dark", lang: "en" },
            updatedAt: "2026-07-01T00:00:00.000Z",
          }
        : null,
    );

    const doc = await setUserState(
      ctx,
      "selections",
      { lang: "he" },
      { source: "server" },
    );
    expect(doc.data).toEqual({ theme: "dark", lang: "he" });
  });

  it("rejects data that fails the namespace schema, without writing", async () => {
    await expect(
      setUserState(
        ctx,
        "stats",
        { visits: "not-a-number" },
        { source: "server" },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof UserStateError &&
        error.code === "validation_failed" &&
        error.status === 422 &&
        error.issues.length > 0,
    );
    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.emitSystemEvent).not.toHaveBeenCalled();
  });
});
