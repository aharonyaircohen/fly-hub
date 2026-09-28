/**
 * Unit tests for the Convex-backed instructions store
 * (src/instructions/files.ts): repoDocs get/save/remove with kind
 * "instructions" and `{ body }` doc shape.
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

vi.mock("../../src/github", () => ({
  getOwner: () => "acme",
  getRepo: () => "widgets",
  getOctokit: () => ({}) as never,
}));

import { _resetConvexClient } from "@kody-ade/base/backend/convex";
import {
  deleteInstructionsFile,
  readInstructionsFile,
  writeInstructionsFile,
  loadInstructionsForPrompt,
  invalidateInstructionsPromptCache,
} from "../../src/instructions/files";

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  invalidateInstructionsPromptCache();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("instructions convex store", () => {
  it("reads the instructions repoDoc", async () => {
    convex.query.mockResolvedValue({
      doc: { body: "Be terse.\n" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const file = await readInstructionsFile();
    expect(file?.body).toBe("Be terse.\n");
    expect(file?.sha).toBe("");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "instructions" });
  });

  it("returns null when missing or malformed", async () => {
    convex.query.mockResolvedValue(null);
    expect(await readInstructionsFile()).toBeNull();
    convex.query.mockResolvedValue({ doc: {}, updatedAt: "t" });
    expect(await readInstructionsFile()).toBeNull();
  });

  it("writes with a trailing newline via repoDocs.save", async () => {
    convex.mutation.mockResolvedValue("id-1");
    const file = await writeInstructionsFile({ body: "Be terse." });
    expect(file.body).toBe("Be terse.\n");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      kind: "instructions",
      doc: { body: "Be terse.\n" },
    });
  });

  it("deletes via repoDocs.remove", async () => {
    convex.mutation.mockResolvedValue(null);
    await deleteInstructionsFile();
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "instructions" });
  });

  it("loadInstructionsForPrompt caches for 60s and returns null when empty", async () => {
    convex.query.mockResolvedValue({ doc: { body: "Overlay.\n" }, updatedAt: "t" });
    expect(await loadInstructionsForPrompt()).toBe("Overlay.");
    expect(await loadInstructionsForPrompt()).toBe("Overlay.");
    expect(convex.query).toHaveBeenCalledTimes(1);

    invalidateInstructionsPromptCache();
    convex.query.mockResolvedValue(null);
    expect(await loadInstructionsForPrompt()).toBeNull();
  });
});
