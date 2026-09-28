/**
 * Unit tests for the Convex-backed brands store (src/brands/files.ts):
 * repoDocs kinds `brand:<slug>` and `brand-disabled:<slug>`.
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

vi.mock("@kody-ade/workspace/github", () => ({
  getOwner: () => "acme",
  getRepo: () => "widgets",
  getOctokit: () => ({}) as never,
}));

import { _resetConvexClient } from "@kody-ade/base/backend/convex";
import {
  disableBrand,
  deleteBrandFile,
  findBrandFileFromList,
  isBrandDeleted,
  listBrandFiles,
  listDeletedBrandSlugs,
  readBrandFile,
  removeBrand,
  writeBrandFile,
} from "../../src/brands/files";

const TENANT = "acme/widgets";
const SCOPE = { owner: "acme", repo: "widgets" };

function brandRecord(slug: string, doc: Record<string, unknown>) {
  return { kind: `brand:${slug}`, doc, updatedAt: "2026-07-01T00:00:00.000Z" };
}

// listBrandFiles issues two listByPrefix queries: "brand:" then "brand-disabled:".
function mockPrefixQueries(
  brands: Array<Record<string, unknown>>,
  disabled: Array<Record<string, unknown>> = [],
) {
  convex.query.mockImplementation((_ref, args: { prefix?: string }) => {
    if (args.prefix === "brand:") return Promise.resolve(brands);
    if (args.prefix === "brand-disabled:") return Promise.resolve(disabled);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("brand files (convex)", () => {
  it("lists brands from one listByPrefix query, normalized", async () => {
    mockPrefixQueries([
      brandRecord("list-brand", {
        slug: "List Brand",
        name: "List Brand",
        accent: "#2563eb",
        locale: "HE_IL",
      }),
    ]);

    await expect(listBrandFiles(SCOPE)).resolves.toEqual([
      expect.objectContaining({
        slug: "list-brand",
        name: "List Brand",
        accent: "#2563eb",
        locale: "he-il",
        source: "repo",
        sha: "",
      }),
    ]);
    const prefixes = convex.query.mock.calls.map(
      ([, args]) => (args as { prefix: string }).prefix,
    );
    expect(prefixes.sort()).toEqual(["brand-disabled:", "brand:"]);
  });

  it("skips malformed brand records instead of failing the list", async () => {
    mockPrefixQueries([
      brandRecord("bad", { slug: "bad", name: "Bad", accent: "blue" }),
      brandRecord("good", { slug: "good", name: "Good", accent: "#2563eb" }),
    ]);

    const brands = await listBrandFiles(SCOPE);
    expect(brands.map((b) => b.slug)).toEqual(["good"]);
  });

  it("does not list brands with a disabled marker", async () => {
    mockPrefixQueries(
      [brandRecord("acme", { slug: "acme", name: "Acme", accent: "#2563eb" })],
      [{ kind: "brand-disabled:acme", doc: { slug: "acme" }, updatedAt: "t" }],
    );

    await expect(listBrandFiles(SCOPE)).resolves.toEqual([]);
    await expect(listDeletedBrandSlugs(SCOPE)).resolves.toEqual(
      new Set(["acme"]),
    );
  });

  it("reads a single brand via repoDocs.get", async () => {
    convex.query.mockResolvedValue(
      brandRecord("solo", { slug: "solo", name: "Solo", accent: "#2563eb" }),
    );

    const brand = await readBrandFile(SCOPE, "solo");
    expect(brand?.slug).toBe("solo");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({ tenantId: TENANT, kind: "brand:solo" });
  });

  it("returns null for a missing or invalid-slug brand", async () => {
    convex.query.mockResolvedValue(null);
    expect(await readBrandFile(SCOPE, "missing")).toBeNull();
    expect(await readBrandFile(SCOPE, "__nope__")).toBeNull();
  });

  it("finds a brand from the list without extra reads", async () => {
    mockPrefixQueries([]);
    await expect(
      findBrandFileFromList(SCOPE, "random-one"),
    ).resolves.toBeNull();
    // Only listByPrefix calls — never a per-slug get.
    for (const [ref] of convex.query.mock.calls) {
      expect(getFunctionName(ref)).toBe("repoDocs:listByPrefix");
    }
  });

  it("writes a normalized brand and clears its disabled marker", async () => {
    convex.mutation.mockResolvedValue(null);

    const written = await writeBrandFile(SCOPE, {
      slug: " Write Brand ",
      name: " Write Brand ",
      accent: "#2563EB",
      locale: "HE_IL",
      welcomeText: "",
      modelId: "sonnet-4",
      agentSlug: "qa_agent",
      appearance: {
        colorScheme: "light",
        background: "#fffaf5",
        surface: "#ffffff",
        foreground: "#292524",
        mutedForeground: "#57534e",
        secondary: "#ede9fe",
        border: "#d6d3d1",
        userMessage: "#6d28d9",
        assistantMessage: "#f5f5f4",
        input: "#ffffff",
        fontSize: "large",
        radius: "rounded",
      },
    });

    expect(written).toMatchObject({
      slug: "write-brand",
      name: "Write Brand",
      accent: "#2563eb",
      locale: "he-il",
      modelId: "sonnet-4",
      appearance: {
        colorScheme: "light",
        background: "#fffaf5",
        surface: "#ffffff",
        foreground: "#292524",
        mutedForeground: "#57534e",
        secondary: "#ede9fe",
        border: "#d6d3d1",
        userMessage: "#6d28d9",
        assistantMessage: "#f5f5f4",
        input: "#ffffff",
        fontSize: "large",
        radius: "rounded",
      },
      source: "repo",
      sha: "",
    });

    const [saveRef, saveArgs] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(saveRef)).toBe("repoDocs:saveAndRemove");
    expect(saveArgs).toMatchObject({
      tenantId: TENANT,
      saveKind: "brand:write-brand",
      doc: expect.objectContaining({
        slug: "write-brand",
        accent: "#2563eb",
        appearance: {
          colorScheme: "light",
          background: "#fffaf5",
          surface: "#ffffff",
          foreground: "#292524",
          mutedForeground: "#57534e",
          secondary: "#ede9fe",
          border: "#d6d3d1",
          userMessage: "#6d28d9",
          assistantMessage: "#f5f5f4",
          input: "#ffffff",
          fontSize: "large",
          radius: "rounded",
        },
      }),
      removeKind: "brand-disabled:write-brand",
    });
    expect(convex.mutation).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid brand input on write", async () => {
    await expect(
      writeBrandFile(SCOPE, {
        slug: "bad",
        name: "Bad",
        accent: "blue",
      }),
    ).rejects.toThrow("hex color");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("rejects invalid appearance colors on write", async () => {
    await expect(
      writeBrandFile(SCOPE, {
        slug: "bad-theme",
        name: "Bad theme",
        accent: "#2563eb",
        appearance: {
          colorScheme: "dark",
          background: "black",
          foreground: "#ffffff",
        },
      }),
    ).rejects.toThrow();
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("rejects unreadable appearance colors on write", async () => {
    await expect(
      writeBrandFile(SCOPE, {
        slug: "low-contrast",
        name: "Low contrast",
        accent: "#2563eb",
        appearance: {
          colorScheme: "light",
          background: "#ffffff",
          foreground: "#eeeeee",
        },
      }),
    ).rejects.toThrow("readable");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("deletes a brand via repoDocs.remove", async () => {
    convex.mutation.mockResolvedValue(null);

    await deleteBrandFile(SCOPE, "deletebrand");

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:remove");
    expect(args).toEqual({ tenantId: TENANT, kind: "brand:deletebrand" });
  });

  it("writes a disabled marker for a deleted fallback brand", async () => {
    convex.mutation.mockResolvedValue(null);

    await disableBrand(SCOPE, "Acme");

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: TENANT,
      kind: "brand-disabled:acme",
      doc: { slug: "acme" },
    });
  });

  it("atomically removes a brand and disables its fallback", async () => {
    convex.mutation.mockResolvedValue(null);

    await removeBrand(SCOPE, "Acme", { disableFallback: true });

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:removeAndMaybeSave");
    expect(args).toMatchObject({
      tenantId: TENANT,
      removeKind: "brand:acme",
      save: {
        kind: "brand-disabled:acme",
        doc: { slug: "acme" },
      },
    });
    expect(convex.mutation).toHaveBeenCalledTimes(1);
  });

  it("isBrandDeleted checks the marker doc directly", async () => {
    convex.query.mockResolvedValue({
      kind: "brand-disabled:acme",
      doc: { slug: "acme" },
      updatedAt: "t",
    });
    expect(await isBrandDeleted(SCOPE, "acme")).toBe(true);
    convex.query.mockResolvedValue(null);
    expect(await isBrandDeleted(SCOPE, "other")).toBe(false);
  });
});
