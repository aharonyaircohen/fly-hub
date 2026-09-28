import { describe, expect, it } from "vitest";

import {
  coerceWorkflowInput,
  normalizeWorkflowDefinition,
  workflowInputFromFacts,
  validateWorkflowInput,
} from "../../src/dashboard/lib/workflow-definitions";

const inputSchema = {
  type: "object",
  properties: {
    issue: { type: "integer", minimum: 1 },
  },
  required: ["issue"],
  additionalProperties: false,
};

describe("workflow input contract", () => {
  it("preserves a workflow-owned input schema", () => {
    expect(
      normalizeWorkflowDefinition({
        name: "Documentation Agency",
        agent: "documentation-lead",
        capabilities: ["define-documentation-brief"],
        inputSchema,
      }),
    ).toMatchObject({ inputSchema });
  });

  it("rejects missing, mistyped, and unknown input fields", () => {
    expect(validateWorkflowInput({}, inputSchema)).toMatchObject([
      { code: "invalid_workflow_input", path: "input.issue" },
    ]);
    expect(validateWorkflowInput({ issue: "42" }, inputSchema)).toMatchObject([
      { code: "invalid_workflow_input", path: "input.issue" },
    ]);
    expect(
      validateWorkflowInput({ issue: 42, invented: true }, inputSchema),
    ).toMatchObject([
      { code: "invalid_workflow_input", path: "input" },
    ]);
    expect(validateWorkflowInput({ issue: 42 }, inputSchema)).toEqual([]);
  });

  it("selects only declared Workflow inputs from shared Pipeline facts", () => {
    expect(
      workflowInputFromFacts(
        { issue: 42, verdict: "pass", internalRunId: "run-1" },
        inputSchema,
      ),
    ).toEqual({ issue: 42 });
    expect(
      workflowInputFromFacts({ issue: 42, verdict: "pass" }, undefined),
    ).toEqual({ issue: 42, verdict: "pass" });
  });

  it("coerces unambiguous primitive strings using the Workflow schema", () => {
    expect(
      coerceWorkflowInput(
        { issue: "42", enabled: "true", label: "42" },
        {
          type: "object",
          properties: {
            issue: { type: "integer" },
            enabled: { type: "boolean" },
            label: { type: "string" },
          },
        },
      ),
    ).toEqual({ issue: 42, enabled: true, label: "42" });
  });

  it("enforces nested, enum, array, and string constraints", () => {
    const schema = {
      type: "object",
      properties: {
        brief: {
          type: "object",
          properties: {
            audience: { enum: ["developer", "operator"] },
            tags: {
              type: "array",
              items: { type: "string", pattern: "^[a-z-]+$" },
              minItems: 1,
            },
          },
          required: ["audience", "tags"],
          additionalProperties: false,
        },
      },
      required: ["brief"],
      additionalProperties: false,
    };

    expect(
      validateWorkflowInput(
        { brief: { audience: "sales", tags: ["Valid Tag"] } },
        schema,
      ),
    ).toMatchObject([
      { code: "invalid_workflow_input", path: "input.brief.audience" },
      { code: "invalid_workflow_input", path: "input.brief.tags.0" },
    ]);
    expect(
      validateWorkflowInput(
        { brief: { audience: "developer", tags: ["api-guide"] } },
        schema,
      ),
    ).toEqual([]);
  });
});
