/**
 * Unit tests for the Convex-backed workflow definition store
 * (src/dashboard/lib/workflow-definition-files.ts): workflows
 * get/list/save/remove with the right tenantId and doc shape.
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
  getOctokit: () => ({}) as never,
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  deleteWorkflowDefinitionFile,
  listWorkflowDefinitionFiles,
  readWorkflowDefinitionFile,
  writeWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";
import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";

const DEFINITION: WorkflowDefinition = {
  name: "release",
  agent: "kody",
  capabilities: ["plan"],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("workflow definition convex store", () => {
  it("reads a workflow via workflows.get", async () => {
    convex.query.mockResolvedValue({
      workflowId: "release",
      definition: DEFINITION,
      updatedAt: DEFINITION.updatedAt,
    });

    const file = await readWorkflowDefinitionFile("release");

    expect(file?.workflow.name).toBe("release");
    expect(file?.path).toBe("workflows/release/workflow.json");
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflows:get");
    expect(args).toEqual({ tenantId: "acme/widgets", workflowId: "release" });
  });

  it("returns null for missing or malformed docs", async () => {
    convex.query.mockResolvedValue(null);
    expect(await readWorkflowDefinitionFile("release")).toBeNull();

    convex.query.mockResolvedValue({
      workflowId: "release",
      definition: { junk: true },
    });
    expect(await readWorkflowDefinitionFile("release")).toBeNull();
  });

  it("does not expose a Store projection as a local workflow", async () => {
    convex.query.mockResolvedValue({
      workflowId: "release",
      definition: DEFINITION,
      source: "store",
      updatedAt: DEFINITION.updatedAt,
    });

    expect(await readWorkflowDefinitionFile("release")).toBeNull();
  });

  it("lists only local workflows sorted by id", async () => {
    convex.query.mockResolvedValue([
      {
        workflowId: "zeta",
        definition: { ...DEFINITION, name: "zeta" },
        source: "local",
      },
      {
        workflowId: "store-copy",
        definition: { ...DEFINITION, name: "store-copy" },
        source: "store",
      },
      {
        workflowId: "alpha",
        definition: { ...DEFINITION, name: "alpha" },
        source: "local",
      },
    ]);

    const records = await listWorkflowDefinitionFiles();

    expect(records.map((record) => record.id)).toEqual(["alpha", "zeta"]);
    expect(records[0]).toMatchObject({ source: "local", runnable: true });
    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflows:list");
    expect(args).toEqual({ tenantId: "acme/widgets" });
  });

  it("saves a workflow via workflows.save with source local", async () => {
    convex.mutation.mockResolvedValue("id-1");

    await writeWorkflowDefinitionFile({ id: "release", workflow: DEFINITION });

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflows:save");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      workflowId: "release",
      definition: DEFINITION,
      source: "local",
      updatedAt: DEFINITION.updatedAt,
    });
  });

  it("deletes a workflow via workflows.remove", async () => {
    convex.mutation.mockResolvedValue(null);

    await deleteWorkflowDefinitionFile({ id: "release" });

    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("workflows:remove");
    expect(args).toEqual({ tenantId: "acme/widgets", workflowId: "release" });
  });
});
