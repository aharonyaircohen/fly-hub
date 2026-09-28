import { describe, expect, it } from "vitest";

import type { GuidedFlowDefinition } from "../../src/dashboard/lib/guided-flows/controller";
import {
  GuidedFlowDefinitionError,
  validateGuidedFlowDefinition,
} from "../../src/dashboard/lib/guided-flows/validation";

function definitionWith(
  steps: GuidedFlowDefinition["steps"],
): GuidedFlowDefinition {
  return {
    id: "validated-flow",
    version: 1,
    title: "Validated flow",
    steps,
  };
}

describe("GuidedFlow definition validation", () => {
  it("accepts one canonical action contract", () => {
    expect(() =>
      validateGuidedFlowDefinition(
        definitionWith([
          {
            id: "start",
            title: "Start",
            explanation: "Continue.",
            rendererSlug: "approval-card",
            rendererData: {
              actions: [{ id: "next", label: "Next", response: "next" }],
            },
            actions: [{ id: "next", target: { type: "step", stepId: "done" } }],
          },
          {
            id: "done",
            title: "Done",
            explanation: "Finish.",
            rendererSlug: "approval-card",
            rendererData: {
              actions: [{ id: "finish", label: "Finish", response: "finish" }],
            },
            actions: [{ id: "finish", target: { type: "complete" } }],
          },
        ]),
      ),
    ).not.toThrow();
  });

  it.each([
    {
      code: "empty_actions",
      steps: [
        {
          id: "start",
          title: "Start",
          explanation: "Start.",
          rendererSlug: "approval-card",
          actions: [],
        },
      ],
    },
    {
      code: "duplicate_step_id",
      steps: [
        {
          id: "same",
          title: "One",
          explanation: "One.",
          rendererSlug: "approval-card",
          actions: [{ id: "finish", target: { type: "complete" } }],
        },
        {
          id: "same",
          title: "Two",
          explanation: "Two.",
          rendererSlug: "approval-card",
          actions: [{ id: "finish", target: { type: "complete" } }],
        },
      ],
    },
    {
      code: "duplicate_action_id",
      steps: [
        {
          id: "start",
          title: "Start",
          explanation: "Start.",
          rendererSlug: "approval-card",
          actions: [
            { id: "finish", target: { type: "complete" } },
            { id: "finish", target: { type: "cancel" } },
          ],
        },
      ],
    },
    {
      code: "invalid_transition_target",
      steps: [
        {
          id: "start",
          title: "Start",
          explanation: "Start.",
          rendererSlug: "approval-card",
          actions: [
            { id: "next", target: { type: "step", stepId: "missing" } },
          ],
        },
      ],
    },
    {
      code: "renderer_action_mismatch",
      steps: [
        {
          id: "start",
          title: "Start",
          explanation: "Start.",
          rendererSlug: "approval-card",
          rendererData: {
            actions: [{ id: "next", label: "Next", response: "next" }],
          },
          actions: [{ id: "finish", target: { type: "complete" } }],
        },
      ],
    },
  ])("rejects $code", ({ code, steps }) => {
    try {
      validateGuidedFlowDefinition(
        definitionWith(steps as GuidedFlowDefinition["steps"]),
      );
      throw new Error("Expected definition validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(GuidedFlowDefinitionError);
      expect((error as GuidedFlowDefinitionError).code).toBe(code);
    }
  });
});
