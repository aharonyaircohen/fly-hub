import { describe, expect, it } from "vitest";

import { wireWorkflowEntryInputs } from "@dashboard/lib/workflow-capability-inputs";
import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";

const workflow: WorkflowDefinition = {
  name: "Import source",
  agent: "kody",
  capabilities: ["import-source"],
  startAt: "import-source",
  steps: [{ id: "import-source", capability: "import-source" }],
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
};

describe("workflow entry inputs", () => {
  it("uses the capability contract as the workflow form and field mappings", () => {
    const result = wireWorkflowEntryInputs(
      workflow,
      JSON.stringify({
        input: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceId: { type: "string", title: "Source" },
            title: { type: "string" },
          },
          required: ["sourceId", "title"],
        },
        output: { type: "object" },
      }),
    );

    expect(result.inputSchema).toMatchObject({
      type: "object",
      required: ["sourceId", "title"],
    });
    expect(result.steps?.[0]?.inputs).toEqual({
      sourceId: { from: "workflow.input.sourceId" },
      title: { from: "workflow.input.title" },
    });
  });

  it("maps only the stable entry step in a multi-step workflow", () => {
    const result = wireWorkflowEntryInputs(
      {
        ...workflow,
        capabilities: ["inspect", "import-source"],
        startAt: "inspect",
        steps: [
          { id: "inspect", capability: "inspect" },
          { id: "import-source", capability: "import-source" },
        ],
      },
      JSON.stringify({
        input: {
          type: "object",
          properties: { sourceId: { type: "string" } },
        },
      }),
    );

    expect(result.inputSchema).toMatchObject({ type: "object" });
    expect(result.steps?.[0]?.inputs).toEqual({
      sourceId: { from: "workflow.input.sourceId" },
    });
    expect(result.steps?.[1]?.inputs).toBeUndefined();
  });
});
