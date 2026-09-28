/**
 * Unit tests for the Convex-backed context store
 * (src/context/files.ts): repoDocs listByPrefix/get/save/remove with kinds
 * `context:<slug>` and `{ body }` docs carrying the agent frontmatter.
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
  deleteContextFile,
  listContextFiles,
  readContextFile,
  writeContextFile,
  invalidateContextPromptCache,
  loadContextForPrompt,
} from "../../src/context/files";

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  invalidateContextPromptCache();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("context convex store", () => {
  it("lists context docs via repoDocs.listByPrefix and parses frontmatter", async () => {
    convex.query.mockResolvedValue([
      {
        kind: "context:mission",
        doc: { body: "---\nagent: [kody]\n---\n\nShip it.\n" },
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        kind: "context:products",
        doc: { body: "Widgets galore.\n" },
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);

    const files = await listContextFiles();

    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:listByPrefix");
    expect(args).toEqual({ tenantId: "acme/widgets", prefix: "context:" });
    expect(files.map((f) => f.slug)).toEqual(["mission", "products"]);
    expect(files[0]!.body).toBe("Ship it.\n");
    expect(files[0]!.agent).toEqual(["kody"]);
    // Legacy frontmatter-less body defaults to the built-in chat agent.
    expect(files[1]!.agent).toEqual(["kody"]);
    expect(files[0]!.sha).toBe("");
  });

  it("skips malformed records and invalid slugs", async () => {
    convex.query.mockResolvedValue([
      { kind: "context:ok", doc: { body: "x" }, updatedAt: "t" },
      { kind: "context:Bad Slug", doc: { body: "x" }, updatedAt: "t" },
      { kind: "context:no-body", doc: {}, updatedAt: "t" },
    ]);
    const files = await listContextFiles();
    expect(files.map((f) => f.slug)).toEqual(["ok"]);
  });

  it("reads one entry via repoDocs.get", async () => {
    convex.query.mockResolvedValue({
      kind: "context:mission",
      doc: { body: "Ship it.\n" },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const file = await readContextFile("mission");
    expect(file?.body).toBe("Ship it.\n");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:get");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "context:mission" });
  });

  it("returns null for invalid slugs without querying", async () => {
    expect(await readContextFile("Bad Slug")).toBeNull();
    expect(convex.query).not.toHaveBeenCalled();
  });

  it("writes body + agent frontmatter via repoDocs.save", async () => {
    convex.mutation.mockResolvedValue("id-1");
    const file = await writeContextFile({
      slug: "mission",
      body: "Ship it.",
      agent: ["kody", "qa-engineer"],
    });
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      kind: "context:mission",
    });
    expect((args as { doc: { body: string } }).doc.body).toContain(
      "agent: [kody, qa-engineer]",
    );
    expect(file.slug).toBe("mission");
    expect(file.agent).toEqual(["kody", "qa-engineer"]);
    expect(file.body).toContain("Ship it.");
  });

  it("rejects invalid slugs on write", async () => {
    await expect(
      writeContextFile({ slug: "Bad Slug", body: "x", agent: [] }),
    ).rejects.toThrow(/Invalid context slug/);
  });

  it("deletes via repoDocs.remove", async () => {
    convex.mutation.mockResolvedValue(null);
    await deleteContextFile("mission");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("repoDocs:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", kind: "context:mission" });
  });

  it("loadContextForPrompt only includes kody/all-agent entries", async () => {
    convex.query.mockResolvedValue([
      {
        kind: "context:mission",
        doc: { body: "---\nagent: [kody]\n---\n\nShip it." },
        updatedAt: "t",
      },
      {
        kind: "context:qa-notes",
        doc: { body: "---\nagent: [qa-engineer]\n---\n\nQA only." },
        updatedAt: "t",
      },
    ]);
    const prompt = await loadContextForPrompt();
    expect(prompt).toContain("### mission");
    expect(prompt).not.toContain("QA only");
  });
});
