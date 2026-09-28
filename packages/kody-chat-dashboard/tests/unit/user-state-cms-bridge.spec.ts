/**
 * Unit tests for the CMS bridge user-state adapter
 * (src/dashboard/lib/user-state/adapters/cms-bridge.ts): prefix parsing,
 * ownership scoping via _kodyUserId, create-vs-update, stamped bookkeeping
 * fields, and typed errors for missing collections.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Octokit } from "@octokit/rest";

const h = vi.hoisted(() => ({
  loadCmsConfigFromState: vi.fn(),
  getCmsAdapter: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@kody-ade/cms/config", () => ({
  loadCmsConfigFromState: h.loadCmsConfigFromState,
}));
vi.mock("@kody-ade/cms/adapters", () => ({
  getCmsAdapter: h.getCmsAdapter,
}));
vi.mock("@kody-ade/cms/adapter-catalog", () => ({
  defaultCmsAdapterSettings: vi.fn(() => ({})),
}));
vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));
vi.mock("@kody-ade/base/vault/store", () => ({ readVault: vi.fn() }));
vi.mock("@kody-ade/base/vault/crypto", () => ({
  isVaultConfigured: vi.fn(() => false),
}));

import {
  cmsBridgeUserStateAdapter,
  parseCmsBridgeCollection,
  KODY_USER_ID_FIELD,
} from "../../src/dashboard/lib/user-state/adapters/cms-bridge";
import { CORE_USER_STATE_NAMESPACES } from "../../src/dashboard/lib/user-state/namespaces/core";
import type {
  UserStateDoc,
  UserStateNamespace,
} from "../../src/dashboard/lib/user-state/types";

const ctx = { octokit: {} as Octokit, owner: "acme", repo: "shop" };
const USER = "client:jane@example.com";

const namespace: UserStateNamespace = {
  ...CORE_USER_STATE_NAMESPACES[0],
  name: "orders",
  origin: "brand",
  adapter: "cms:orders",
};

function doc(data: Record<string, unknown>): UserStateDoc {
  return {
    version: 1,
    namespace: "orders",
    userId: USER,
    updatedAt: "2026-07-12T00:00:00.000Z",
    data,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadCmsConfigFromState.mockResolvedValue({
    collections: {
      orders: {
        name: "orders",
        adapter: "mongodb",
        source: { idField: "_id" },
      },
    },
    adapters: {},
  });
  h.getCmsAdapter.mockReturnValue({
    name: "mongodb",
    list: h.list,
    create: h.create,
    update: h.update,
  });
  h.list.mockResolvedValue({ docs: [], total: 0, limit: 1, offset: 0 });
});

describe("parseCmsBridgeCollection", () => {
  it("parses cms:<collection> and rejects other names", () => {
    expect(parseCmsBridgeCollection("cms:orders")).toBe("orders");
    expect(parseCmsBridgeCollection("convex")).toBeNull();
    expect(parseCmsBridgeCollection("cms:")).toBeNull();
  });
});

describe("get", () => {
  it("filters by the ownership field and strips bookkeeping keys", async () => {
    h.list.mockResolvedValue({
      docs: [
        {
          _id: "abc",
          [KODY_USER_ID_FIELD]: USER,
          _kodyNamespaceVersion: 1,
          _kodyUpdatedAt: "2026-07-10T00:00:00.000Z",
          total: 42,
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
    });

    const result = await cmsBridgeUserStateAdapter.get(ctx, USER, namespace);

    expect(h.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: { [KODY_USER_ID_FIELD]: { equals: USER } },
        limit: 1,
      }),
    );
    expect(result).toMatchObject({
      namespace: "orders",
      userId: USER,
      updatedAt: "2026-07-10T00:00:00.000Z",
      data: { total: 42 },
    });
  });

  it("rejects a document the adapter returned for another user", async () => {
    h.list.mockResolvedValue({
      docs: [{ _id: "abc", [KODY_USER_ID_FIELD]: "client:other@x.io" }],
      total: 1,
      limit: 1,
      offset: 0,
    });
    expect(
      await cmsBridgeUserStateAdapter.get(ctx, USER, namespace),
    ).toBeNull();
  });

  it("returns null when the user has no document", async () => {
    expect(
      await cmsBridgeUserStateAdapter.get(ctx, USER, namespace),
    ).toBeNull();
  });

  it("throws a typed error when the collection is not configured", async () => {
    h.loadCmsConfigFromState.mockResolvedValue(null);
    await expect(
      cmsBridgeUserStateAdapter.get(ctx, USER, namespace),
    ).rejects.toMatchObject({ code: "config_invalid", status: 400 });
  });
});

describe("set", () => {
  it("creates a stamped document when none exists", async () => {
    await cmsBridgeUserStateAdapter.set(
      ctx,
      USER,
      namespace,
      doc({ total: 1 }),
    );
    expect(h.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        total: 1,
        [KODY_USER_ID_FIELD]: USER,
        _kodyNamespaceVersion: 1,
        _kodyUpdatedAt: "2026-07-12T00:00:00.000Z",
      }),
    );
    expect(h.update).not.toHaveBeenCalled();
  });

  it("updates the existing owned document by id", async () => {
    h.list.mockResolvedValue({
      docs: [{ _id: "abc", [KODY_USER_ID_FIELD]: USER }],
      total: 1,
      limit: 1,
      offset: 0,
    });
    await cmsBridgeUserStateAdapter.set(
      ctx,
      USER,
      namespace,
      doc({ total: 2 }),
    );
    expect(h.update).toHaveBeenCalledWith(
      expect.anything(),
      "abc",
      expect.objectContaining({ total: 2, [KODY_USER_ID_FIELD]: USER }),
    );
    expect(h.create).not.toHaveBeenCalled();
  });
});
