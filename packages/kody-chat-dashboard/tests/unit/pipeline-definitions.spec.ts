import { describe, expect, it } from "vitest";
import {
  buildPipelineDefinition,
  validatePipelineDefinition,
} from "../../src/dashboard/lib/pipeline-definitions";

describe("Pipeline definitions", () => {
  it("keeps Pipeline steps limited to Workflow references", () => {
    const pipeline = buildPipelineDefinition({
      name: "Review then merge",
      steps: [
        { id: "review", workflow: "review-fix" },
        { id: "merge", workflow: "merge" },
      ],
    });

    expect(
      validatePipelineDefinition(pipeline, {
        knownWorkflows: new Set(["review-fix", "merge"]),
      }),
    ).toEqual([]);
  });

  it("rejects duplicate steps and missing Workflows", () => {
    const pipeline = buildPipelineDefinition({
      name: "Broken",
      steps: [
        { id: "same", workflow: "review-fix" },
        { id: "same", workflow: "missing" },
      ],
    });

    expect(
      validatePipelineDefinition(pipeline, {
        knownWorkflows: new Set(["review-fix"]),
      }).map((issue) => issue.code),
    ).toEqual(["duplicate_step_id", "unknown_workflow"]);
  });

  it("drops legacy mappings because Pipeline facts flow automatically", () => {
    const pipeline = buildPipelineDefinition({
      name: "Review then merge",
      steps: [
        {
          id: "merge",
          workflow: "merge",
          inputMap: { pr: "previous.pr" },
        } as never,
      ],
    });

    expect(pipeline.steps).toEqual([{ id: "merge", workflow: "merge" }]);
  });

  it("keeps an explicit decision fact on a Pipeline step", () => {
    const pipeline = buildPipelineDefinition({
      name: "QA maintenance",
      steps: [
        {
          id: "issues",
          workflow: "qa-issue-sync",
          decisionFact: "deliveryDecision",
        },
        { id: "fix", workflow: "qa-fix" },
      ],
    });

    expect(pipeline.steps[0]).toEqual({
      id: "issues",
      workflow: "qa-issue-sync",
      decisionFact: "deliveryDecision",
    });
    expect(validatePipelineDefinition(pipeline)).toEqual([]);
  });
});
