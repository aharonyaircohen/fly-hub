/**
 * Unit tests for the Convex-backed view renderer store
 * (src/dashboard/lib/view-renderers/renderers.ts IO functions):
 * viewRenderers list/save/remove with the right tenantId + doc shape.
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

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  deleteViewRendererDefinitionFile,
  listViewRendererDefinitionFiles,
  readViewRendererDefinitionFile,
  writeViewRendererDefinitionFile,
  type ViewRendererDefinition,
} from "@dashboard/lib/view-renderers/renderers";

const DEFINITION: ViewRendererDefinition = {
  slug: "decision-card",
  name: "Decision card",
  purpose: "decision",
  rule: "Use this purpose when Kody presents a decision.",
  data: {
    title: { type: "text", description: "Short heading." },
  },
  type: "layout",
  ui: {
    type: "stack",
    children: [{ type: "text", value: "$title", variant: "title" }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("view renderers convex store", () => {
  it("reads one renderer from viewRenderers.list", async () => {
    convex.query.mockResolvedValue([
      { slug: "decision-card", definition: DEFINITION },
    ]);

    const file = await readViewRendererDefinitionFile({
      owner: "acme",
      repo: "widgets",
      slug: "decision-card",
    });

    expect(file?.definition.slug).toBe("decision-card");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("viewRenderers:list");
    expect(args).toEqual({ tenantId: "acme/widgets" });
  });

  it("returns null for unknown or invalid slugs", async () => {
    convex.query.mockResolvedValue([]);
    expect(
      await readViewRendererDefinitionFile({
        owner: "acme",
        repo: "widgets",
        slug: "missing",
      }),
    ).toBeNull();
    expect(
      await readViewRendererDefinitionFile({
        owner: "acme",
        repo: "widgets",
        slug: "Bad Slug!",
      }),
    ).toBeNull();
  });

  it("falls back to built-in renderers when the repository has no overrides", async () => {
    convex.query.mockResolvedValue([]);

    const file = await readViewRendererDefinitionFile({
      owner: "acme",
      repo: "widgets",
      slug: "guided-form",
    });
    const files = await listViewRendererDefinitionFiles({
      owner: "acme",
      repo: "widgets",
    });

    expect(file).toMatchObject({ source: "builtin" });
    expect(files.map((entry) => entry.definition.slug)).toEqual([
      "guided-flow-command",
      "approval-card",
      "selection-list",
      "multi-select-list",
      "guided-flow-status",
      "guided-form",
    ]);
  });

  it("lists renderers and skips docs that fail schema validation", async () => {
    convex.query.mockResolvedValue([
      { slug: "decision-card", definition: DEFINITION },
      { slug: "broken", definition: { junk: true } },
    ]);

    const files = await listViewRendererDefinitionFiles({
      owner: "acme",
      repo: "widgets",
    });

    expect(files.map((file) => file.definition.slug)).toEqual([
      "decision-card",
      "guided-flow-command",
      "approval-card",
      "selection-list",
      "multi-select-list",
      "guided-flow-status",
      "guided-form",
    ]);
  });

  it("saves a renderer via viewRenderers.save", async () => {
    convex.mutation.mockResolvedValue("id-1");

    const file = await writeViewRendererDefinitionFile({
      owner: "acme",
      repo: "widgets",
      definition: DEFINITION,
    });

    expect(file.definition.slug).toBe("decision-card");
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("viewRenderers:save");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      slug: "decision-card",
    });
    expect(
      (args as { definition: ViewRendererDefinition }).definition.slug,
    ).toBe("decision-card");
  });

  it("deletes a renderer via viewRenderers.remove", async () => {
    convex.mutation.mockResolvedValue(null);

    await deleteViewRendererDefinitionFile({
      owner: "acme",
      repo: "widgets",
      slug: "decision-card",
    });

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("viewRenderers:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", slug: "decision-card" });
  });
});
