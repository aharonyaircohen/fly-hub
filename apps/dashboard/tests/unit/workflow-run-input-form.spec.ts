import { describe, expect, it } from "vitest";

import {
  parseWorkflowRunInput,
  workflowRunInputForm,
} from "@dashboard/features/workflows/workflow-run-input-form";

describe("workflow run input form", () => {
  it("builds and parses simple fields from the workflow contract", () => {
    const form = workflowRunInputForm({
      type: "object",
      properties: {
        issue: {
          type: "integer",
          minimum: 1,
          description: "GitHub issue number.",
        },
      },
      required: ["issue"],
    });

    expect(form).toEqual({
      kind: "fields",
      fields: [
        {
          name: "issue",
          type: "integer",
          required: true,
          minimum: 1,
          description: "GitHub issue number.",
        },
      ],
    });
    expect(parseWorkflowRunInput(form, { issue: "42" }, "{}")).toEqual({
      issue: 42,
    });
  });

  it("uses JSON input for nested contracts", () => {
    const form = workflowRunInputForm({
      type: "object",
      properties: {
        brief: { type: "object", properties: { audience: { type: "string" } } },
      },
    });

    expect(form).toEqual({ kind: "json" });
    expect(
      parseWorkflowRunInput(
        form,
        {},
        '{"brief":{"audience":"developer"}}',
      ),
    ).toEqual({ brief: { audience: "developer" } });
  });
});
