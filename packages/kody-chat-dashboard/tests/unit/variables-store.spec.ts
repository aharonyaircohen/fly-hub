/**
 * Unit tests for the Convex-backed variables store (repoDocs kind
 * "variables", doc = the VariablesDocument).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { _resetConvexClient } from "@kody-ade/base/backend/convex";
import {
  invalidateVariablesCache,
  listVariables,
  readVariables,
  updateVariables,
  writeVariables,
  type VariablesDocument,
} from "@kody-ade/base/variables/store";

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

const DOC: VariablesDocument = {
  version: 1,
  variables: {
    LLM_MODELS: {
      value: "[]",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "alice",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
  invalidateVariablesCache("acme", "widgets");
});

afterEach(() => {
  invalidateVariablesCache("acme", "widgets");
});

describe("readVariables", () => {
  it("reads the variables repoDoc for the tenant", async () => {
    convex.query.mockResolvedValue({ doc: DOC, updatedAt: "t" });

    const { doc, sha } = await readVariables("acme", "widgets");

    expect(doc).toEqual(DOC);
    expect(sha).toBeNull();
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "variables" });
  });

  it("returns an empty document when no record exists", async () => {
    convex.query.mockResolvedValue(null);

    const { doc, sha } = await readVariables("acme", "widgets");

    expect(doc).toEqual({ version: 1, variables: {} });
    expect(sha).toBeNull();
  });

  it("caches reads for the TTL", async () => {
    convex.query.mockResolvedValue({ doc: DOC, updatedAt: "t" });

    await readVariables("acme", "widgets");
    await readVariables("acme", "widgets");

    expect(convex.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed document", async () => {
    convex.query.mockResolvedValue({ doc: { nope: true }, updatedAt: "t" });

    await expect(
      readVariables("acme", "widgets"),
    ).rejects.toThrow("unexpected shape");
  });
});

describe("writeVariables", () => {
  it("saves the document via repoDocs.save", async () => {
    convex.mutation.mockResolvedValue("id-1");

    const { sha } = await writeVariables("acme", "widgets", DOC);

    expect(sha).toBe("");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      kind: "variables",
      doc: DOC,
    });
  });
});

describe("updateVariables", () => {
  it("applies the mutation over the latest document", async () => {
    convex.query.mockResolvedValue({ doc: DOC, updatedAt: "t" });
    convex.mutation.mockResolvedValue("id-1");

    const { doc } = await updateVariables(
      "acme",
      "widgets",
      (current) => ({
        ...current,
        variables: {
          ...current.variables,
          NEW_VAR: { value: "x", updatedAt: "t2" },
        },
      }),
    );

    expect(doc.variables.NEW_VAR?.value).toBe("x");
    const [, args] = convex.mutation.mock.calls[0]!;
    expect(
      (args as { doc: VariablesDocument }).doc.variables.NEW_VAR?.value,
    ).toBe("x");
  });
});

describe("listVariables", () => {
  it("returns values sorted by name", () => {
    const doc: VariablesDocument = {
      version: 1,
      variables: {
        ZED: { value: "z", updatedAt: "t2" },
        ABLE: { value: "a", updatedAt: "t1", updatedBy: "bob" },
      },
    };

    expect(listVariables(doc)).toEqual([
      { name: "ABLE", value: "a", updatedAt: "t1", updatedBy: "bob" },
      { name: "ZED", value: "z", updatedAt: "t2", updatedBy: undefined },
    ]);
  });
});
