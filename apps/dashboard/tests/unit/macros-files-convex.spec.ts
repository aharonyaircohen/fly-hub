/**
 * Unit tests for the Convex-backed macros store
 * (src/dashboard/lib/macros-files.ts): macros list/save/remove with the
 * right tenantId + doc shape, newest-first ordering, and add/rename/delete
 * semantics.
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

vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: () => "acme",
  getRepo: () => "widgets",
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  addMacroToFile,
  deleteMacroFromFile,
  readMacrosFile,
  renameMacroInFile,
} from "@dashboard/lib/macros-files";
import type { Macro } from "@dashboard/lib/macros";

const OLD: Macro = {
  id: "checkout-1a2b",
  name: "Checkout",
  createdAt: 1_000,
  steps: [{ type: "click", selector: "#buy" } as never],
};

const NEW: Macro = {
  id: "login-9z8y",
  name: "Login",
  createdAt: 2_000,
  steps: [{ type: "click", selector: "#login" } as never],
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("macros convex store", () => {
  it("lists macros newest-first via macros.list", async () => {
    convex.query.mockResolvedValue([{ macro: OLD }, { macro: NEW }]);

    const { macros, sha } = await readMacrosFile();

    expect(macros.map((m) => m.id)).toEqual(["login-9z8y", "checkout-1a2b"]);
    expect(sha).toBeNull();
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("macros:list");
    expect(args).toEqual({ tenantId: "acme/widgets" });
  });

  it("drops malformed macro docs", async () => {
    convex.query.mockResolvedValue([{ macro: { junk: true } }, { macro: NEW }]);
    const { macros } = await readMacrosFile();
    expect(macros).toEqual([NEW]);
  });

  it("adds a macro via macros.save with server-stamped id", async () => {
    convex.mutation.mockResolvedValue("id-1");

    const macro = await addMacroToFile({ name: "My Flow", steps: OLD.steps });

    expect(macro.name).toBe("My Flow");
    expect(macro.id).toMatch(/^my-flow-[a-z0-9]{4}$/);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("macros:save");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      macroId: macro.id,
      macro,
    });
  });

  it("rejects empty names and zero-step macros", async () => {
    await expect(addMacroToFile({ name: "  ", steps: OLD.steps })).rejects.toThrow(
      /name is required/,
    );
    await expect(addMacroToFile({ name: "x", steps: [] })).rejects.toThrow(
      /at least one step/,
    );
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("deletes a macro via macros.remove and reports missing ids", async () => {
    convex.query.mockResolvedValue([{ macro: OLD }]);
    convex.mutation.mockResolvedValue(null);

    expect(await deleteMacroFromFile({ id: OLD.id })).toBe(true);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("macros:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", macroId: OLD.id });

    convex.mutation.mockClear();
    expect(await deleteMacroFromFile({ id: "missing" })).toBe(false);
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("renames a macro by re-saving it", async () => {
    convex.query.mockResolvedValue([{ macro: OLD }]);
    convex.mutation.mockResolvedValue("id-1");

    const updated = await renameMacroInFile({ id: OLD.id, name: "Buy Now" });

    expect(updated).toEqual({ ...OLD, name: "Buy Now" });
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("macros:save");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      macroId: OLD.id,
      macro: { ...OLD, name: "Buy Now" },
    });
  });

  it("returns null when renaming an unknown macro", async () => {
    convex.query.mockResolvedValue([]);
    expect(await renameMacroInFile({ id: "missing", name: "x" })).toBeNull();
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
