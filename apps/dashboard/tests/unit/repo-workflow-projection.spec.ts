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
import { reconcileProjectedStoreWorkflows } from "@dashboard/lib/backend/repo-projection";
import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";

const CURRENT: WorkflowDefinitionRecord = {
  id: "chore",
  path: "catalog/workflows/chore/workflow.json",
  workflow: {
    name: "Chore",
    agent: "kody",
    capabilities: ["run", "review", "fix"],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
  source: "store",
  readOnly: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("Store workflow projection", () => {
  it("replaces stale Store views with the current Store workflows", async () => {
    convex.query.mockResolvedValue([
      {
        workflowId: "old-store-workflow",
        definition: CURRENT.workflow,
        source: "store",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        workflowId: "local-workflow",
        definition: CURRENT.workflow,
        source: "local",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    await reconcileProjectedStoreWorkflows("acme", "widgets", [CURRENT]);

    const calls = convex.mutation.mock.calls.map(([ref, args]) => ({
      name: getFunctionName(ref),
      args,
    }));
    expect(calls).toContainEqual({
      name: "workflows:save",
      args: expect.objectContaining({
        tenantId: "acme/widgets",
        workflowId: "chore",
        source: "store",
      }),
    });
    expect(calls).toContainEqual({
      name: "workflows:remove",
      args: {
        tenantId: "acme/widgets",
        workflowId: "old-store-workflow",
      },
    });
    expect(calls).not.toContainEqual({
      name: "workflows:remove",
      args: expect.objectContaining({ workflowId: "local-workflow" }),
    });
  });
});
