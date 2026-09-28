import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingBrowserRepositoryAuth,
  loadPendingBrowserRepositoryAuth,
  loadAccountRepositoryAuth,
  saveAccountRepositoryAuth,
  savePendingBrowserRepositoryAuth,
} from "../../src/dashboard/lib/account-repository-persistence";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

beforeEach(() => {
  values.clear();
  vi.restoreAllMocks();
});

describe("account repository persistence", () => {
  it("keeps legacy repository state pending until the user chooses", () => {
    const auth = { owner: "acme", repo: "app", token: "secret" };

    savePendingBrowserRepositoryAuth(auth);

    expect(loadPendingBrowserRepositoryAuth()).toEqual(auth);
    clearPendingBrowserRepositoryAuth();
    expect(loadPendingBrowserRepositoryAuth()).toBeNull();
  });

  it("reports whether an account import was accepted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 400 }));

    await expect(saveAccountRepositoryAuth({ invalid: true })).resolves.toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/account/repositories",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("distinguishes a legacy unauthenticated browser from an empty account", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    await expect(loadAccountRepositoryAuth()).resolves.toEqual({
      status: "unauthenticated",
    });
  });
});
