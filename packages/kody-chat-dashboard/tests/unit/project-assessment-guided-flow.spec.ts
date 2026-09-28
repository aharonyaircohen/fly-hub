import { describe, expect, it } from "vitest";
import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
} from "../../src/dashboard/lib/guided-flows/controller";
import {
  PROJECT_ASSESSMENT_FLOW,
  PROJECT_ASSESSMENT_FLOW_V1,
  PROJECT_ASSESSMENT_FLOW_ID,
} from "../../src/dashboard/lib/guided-flows/builtins/project-assessment";
import { buildGuidedFlowView } from "../../src/dashboard/lib/guided-flows/presentation";

describe("project assessment GuidedFlow", () => {
  it("explains the process before asking seven questions", () => {
    expect(PROJECT_ASSESSMENT_FLOW).toMatchObject({
      id: PROJECT_ASSESSMENT_FLOW_ID,
      version: 2,
      controls: ["back"],
    });
    expect(PROJECT_ASSESSMENT_FLOW_V1).toMatchObject({
      id: PROJECT_ASSESSMENT_FLOW_ID,
      version: 1,
    });
    expect(PROJECT_ASSESSMENT_FLOW_V1.steps).toHaveLength(7);
    expect(PROJECT_ASSESSMENT_FLOW.steps).toHaveLength(8);
    expect(PROJECT_ASSESSMENT_FLOW.steps[0]).toMatchObject({
      id: "introduction",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Deep project assessment",
        actions: [expect.objectContaining({ label: "Begin questions" })],
      },
      actions: [
        {
          id: "continue",
          target: { type: "step", stepId: "project-expectations" },
        },
      ],
    });

    for (const [index, step] of PROJECT_ASSESSMENT_FLOW.steps
      .slice(1)
      .entries()) {
      expect(step.explanation.length).toBeGreaterThan(40);
      expect(step).toMatchObject({
        rendererSlug: "guided-form",
        rendererData: {
          title: `Question ${index + 1} of 7`,
          fields: [expect.objectContaining({ name: expect.any(String) })],
          submitLabel: index === 6 ? "Start assessment" : "Continue",
        },
      });
      expect(
        (step as { rendererData?: { fields?: unknown[] } }).rendererData?.fields,
      ).toHaveLength(1);
    }

    const firstView = buildGuidedFlowView(
      PROJECT_ASSESSMENT_FLOW,
      createGuidedFlowInstance(PROJECT_ASSESSMENT_FLOW, "assessment-view"),
    );
    expect(JSON.stringify(firstView.ui)).toContain("Begin questions");
  });

  it("keeps every answer while moving through all seven steps", () => {
    let instance = createGuidedFlowInstance(
      PROJECT_ASSESSMENT_FLOW,
      "assessment-1",
    );
    instance = advanceGuidedFlow(PROJECT_ASSESSMENT_FLOW, instance, {
      actionId: "continue",
    });

    const answers = [
      ["projectExpectations", "Grow to 10,000 users"],
      ["businessCriticality", "Customer-facing; four hours downtime maximum"],
      ["teamSizeAndRoles", "One founder and coding agents"],
      ["relevantExperience", "Strong product knowledge; limited operations"],
      ["systemKnowledge", "Mostly held by the founder"],
      ["maintenanceTime", "Four hours each week"],
      ["additionalComments", "Write the report in English"],
    ] as const;

    for (const [name, value] of answers) {
      instance = advanceGuidedFlow(PROJECT_ASSESSMENT_FLOW, instance, {
        actionId: "submit",
        result: { [name]: value },
      });
      expect(instance.data[name]).toBe(value);
    }

    expect(instance.status).toBe("completed");
    expect(instance.revision).toBe(8);
    expect(instance.data).toMatchObject(Object.fromEntries(answers));
  });
});
