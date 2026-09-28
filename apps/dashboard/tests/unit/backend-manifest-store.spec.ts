import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const mutation = vi.fn();

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query, mutation }),
}));

vi.mock("@kody-ade/base/github/core", () => ({
  getOwner: () => "acme",
  getRepo: () => "app",
}));

import { createBackendManifestStore } from "@kody-ade/base/backend-manifest-store";

type Manifest = { version: 1; values: string[] };

function createStore(maxBytes?: number) {
  return createBackendManifestStore<Manifest>({
    kind: "test",
    name: "test manifest",
    empty: () => ({ version: 1, values: [] }),
    parse: (value) => value as Manifest,
    maxBytes,
  });
}

describe("backend manifest store", () => {
  beforeEach(() => {
    query.mockReset();
    mutation.mockReset();
  });

  it("reads a repo-scoped manifest from Convex", async () => {
    query.mockResolvedValue({
      doc: { version: 1, values: ["saved"] },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(createStore().readFresh()).resolves.toEqual({
      number: null,
      manifest: { version: 1, values: ["saved"] },
    });
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: "acme/app", kind: "test" },
    );
  });

  it("writes with optimistic concurrency", async () => {
    query.mockResolvedValue({
      doc: { version: 1, values: ["old"] },
      updatedAt: "old-revision",
    });
    mutation.mockResolvedValue("manifest-id");

    const result = await createStore().mutate((current) => ({
      next: { ...current, values: [...current.values, "new"] },
      result: "done",
    }));

    expect(result).toMatchObject({
      result: "done",
      manifest: { version: 1, values: ["old", "new"] },
    });
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/app",
        kind: "test",
        expectedUpdatedAt: "old-revision",
      }),
    );
  });

  it("re-reads and retries a write conflict", async () => {
    query
      .mockResolvedValueOnce({
        doc: { version: 1, values: ["first"] },
        updatedAt: "revision-1",
      })
      .mockResolvedValueOnce({
        doc: { version: 1, values: ["second"] },
        updatedAt: "revision-2",
      });
    mutation
      .mockRejectedValueOnce(new Error("Manifest changed since it was read"))
      .mockResolvedValueOnce("manifest-id");

    const result = await createStore().mutate((current) => ({
      next: { ...current, values: [...current.values, "new"] },
      result: current.values[0],
    }));

    expect(mutation).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      result: "second",
      manifest: { version: 1, values: ["second", "new"] },
    });
  });

  it("does not write a no-op and rejects oversized manifests", async () => {
    query.mockResolvedValue(null);
    await expect(
      createStore().mutate(() => ({ kind: "noop", result: "same" })),
    ).resolves.toEqual({ kind: "noop", result: "same" });
    expect(mutation).not.toHaveBeenCalled();

    await expect(
      createStore(10).mutate(() => ({
        next: { version: 1, values: ["too large"] },
        result: null,
      })),
    ).rejects.toThrow(/oversized/i);
  });
});
