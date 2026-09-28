import { describe, expect, it } from "vitest";
import {
  buildGuidedFlowDefinition,
  deriveGuidedFlowRendererData,
  migrateLegacyGuidedFlowDefinition,
  validateGuidedFlowDraft,
  type GuidedFlowDraft,
} from "../../src/dashboard/lib/guided-flows/authoring";
import {
  isCommandGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
  type GuidedFlowViewStepDefinition,
} from "../../src/dashboard/lib/guided-flows/controller";

function viewStep(
  definition: GuidedFlowDefinition,
  index: number,
): GuidedFlowViewStepDefinition {
  const step = definition.steps[index];
  if (!step || isNestedGuidedFlowStep(step) || isCommandGuidedFlowStep(step)) {
    throw new Error(`Expected view step ${index + 1}`);
  }
  return step;
}

const validDraft: GuidedFlowDraft = {
  title: "Review a release",
  completionRouteId: "workflows",
  controls: ["back"],
  steps: [
    {
      title: "Confirm the release",
      explanation: "Check the release details before continuing.",
      rendererSlug: "approval-card",
    },
  ],
};

describe("guided flow authoring", () => {
  it("builds an independently authored Guided Flow", () => {
    const definition = buildGuidedFlowDefinition(validDraft, "review-release");

    expect(definition).toMatchObject({
      id: "review-release",
      title: "Review a release",
    });
    expect(definition).not.toHaveProperty("purpose");
    expect(definition).not.toHaveProperty("source");
  });

  it("stores a command step as a raw chat command with generic actions", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Initialize Kody",
      steps: [
        {
          type: "command",
          title: "Initialize Kody Engine",
          explanation: "Run the standard initialization command.",
          command: "/init",
        },
      ],
    });
    const step = definition.steps[0];

    expect(step && isCommandGuidedFlowStep(step)).toBe(true);
    expect(step).toEqual({
      id: "step-1",
      type: "command",
      title: "Initialize Kody Engine",
      explanation: "Run the standard initialization command.",
      command: "/init",
      actions: [
        { id: "run", target: { type: "stay" } },
        { id: "continue", target: { type: "complete" } },
      ],
    });
  });

  it("rejects command steps that do not contain one slash command", () => {
    expect(
      validateGuidedFlowDraft({
        title: "Invalid command",
        steps: [
          {
            type: "command",
            title: "Run",
            explanation: "Run it.",
            command: "init",
          },
        ],
      }),
    ).toEqual({
      steps: "Enter one valid slash command for every command step.",
    });
  });

  it("generates a simple sign-in form from a plain-language goal", () => {
    expect(
      deriveGuidedFlowRendererData(
        "guided-form",
        "Ask for the client sign-in details",
      ),
    ).toMatchObject({
      fields: [
        { name: "clientId", label: "Client ID" },
        { name: "clientSecret", label: "Client secret", inputType: "password" },
        { name: "issuer", label: "Issuer" },
      ],
    });
  });

  it("generates visible choices for a selection goal", () => {
    expect(
      deriveGuidedFlowRendererData("selection-list", "Select parent"),
    ).toMatchObject({
      items: [
        { id: "option-1", label: "Parent 1" },
        { id: "option-2", label: "Parent 2" },
        { id: "option-3", label: "Parent 3" },
      ],
    });
  });

  it("generates approval actions named in the goal", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Review request",
      steps: [
        {
          title: "Review request",
          explanation: "Ask user for confirm, decline, edit, redo",
          rendererSlug: "approval-card",
        },
      ],
    });

    expect(viewStep(definition, 0).rendererData).toMatchObject({
      actions: [
        { id: "confirm", label: "Confirm" },
        { id: "decline", label: "Decline" },
        { id: "edit", label: "Edit" },
        { id: "redo", label: "Redo" },
      ],
    });
  });

  it("stores generated renderer data in the saved definition", () => {
    const definition = buildGuidedFlowDefinition({
      ...validDraft,
      steps: [
        {
          title: "Configure sign-in",
          explanation: "Ask for the client sign-in details",
          rendererSlug: "guided-form",
        },
      ],
    });
    expect(viewStep(definition, 0).rendererData).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ name: "clientId" }),
        expect.objectContaining({ name: "clientSecret" }),
      ]),
    });
  });

  it("preserves the page owned by an authored step", () => {
    const definition = buildGuidedFlowDefinition({
      ...validDraft,
      steps: [
        {
          title: "Configure secrets",
          explanation: "Add the required secret on its owning page.",
          routeId: "secrets",
          rendererSlug: "approval-card",
        },
      ],
    });

    expect(definition.steps[0]).toMatchObject({ routeId: "secrets" });
  });

  it("preserves dynamic page parameters without teaching the flow about routes", () => {
    const definition = buildGuidedFlowDefinition({
      ...validDraft,
      completionRouteId: "task",
      completionRouteParameters: { issueNumber: "42" },
      steps: [
        {
          title: "Open the task",
          explanation: "Review the task.",
          routeId: "task",
          routeParameters: { issueNumber: "42" },
          rendererSlug: "approval-card",
        },
      ],
    });

    expect(definition).toMatchObject({
      completionRouteParameters: { issueNumber: "42" },
      steps: [
        expect.objectContaining({
          routeParameters: { issueNumber: "42" },
        }),
      ],
    });
  });

  it("builds a stable definition with generated ids and renderer data", () => {
    expect(buildGuidedFlowDefinition(validDraft, "review-release")).toEqual({
      id: "review-release",
      version: 1,
      title: "Review a release",
      completionRouteId: "workflows",
      controls: ["back"],
      steps: [
        {
          id: "step-1",
          title: "Confirm the release",
          explanation: "Check the release details before continuing.",
          rendererSlug: "approval-card",
          rendererData: {
            title: "Confirm the release",
            actions: [
              {
                id: "continue",
                label: "Finish",
                response: "continue",
                variant: "primary",
              },
            ],
          },
          actions: [{ id: "continue", target: { type: "complete" } }],
        },
      ],
    });
  });

  it("omits controls when the author did not enable any", () => {
    const definition = buildGuidedFlowDefinition({
      ...validDraft,
      controls: [],
    });

    expect(definition).not.toHaveProperty("controls");
  });

  it("rejects duplicate controls", () => {
    expect(
      validateGuidedFlowDraft({
        ...validDraft,
        controls: ["back", "back"],
      }),
    ).toEqual({ controls: "Choose each control only once." });
  });

  it("uses the multi-select renderer's submit action for the final step", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Choose items",
      steps: [
        {
          title: "Choose items",
          explanation: "Select one or more items.",
          rendererSlug: "multi-select-list",
        },
      ],
    });

    expect(definition.steps[0]).toMatchObject({
      rendererSlug: "multi-select-list",
      actions: [{ id: "submit", target: { type: "complete" } }],
    });
  });

  it("preserves authored multi-select options", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Choose environments",
      steps: [
        {
          title: "Choose environments",
          explanation: "Select environments.",
          rendererSlug: "multi-select-list",
          rendererData: {
            items: [
              { id: "staging", label: "Staging" },
              { id: "production", label: "Production" },
            ],
          },
        },
      ],
    });

    expect(viewStep(definition, 0).rendererData).toMatchObject({
      items: [
        { id: "staging", label: "Staging" },
        { id: "production", label: "Production" },
      ],
    });
  });

  it("preserves a generic CMS source for a selection step", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Choose parent and child records",
      steps: [
        {
          title: "Choose a parent record",
          explanation: "Choose the parent record.",
          rendererSlug: "selection-list",
          itemsSource: {
            type: "cms",
            collection: "parents",
            labelField: "name",
            valueField: "id",
            resultField: "parentId",
          },
        },
        {
          title: "Choose a child record",
          explanation: "Choose a child record from the selected parent.",
          rendererSlug: "selection-list",
          itemsSource: {
            type: "cms",
            collection: "children",
            labelField: "name",
            valueField: "id",
            resultField: "childId",
            filter: { field: "parent", fromResultField: "parentId" },
          },
        },
      ],
    });

    expect(viewStep(definition, 0).itemsSource).toEqual({
      type: "cms",
      collection: "parents",
      labelField: "name",
      valueField: "id",
      resultField: "parentId",
    });
    expect(viewStep(definition, 1).itemsSource).toEqual({
      type: "cms",
      collection: "children",
      labelField: "name",
      valueField: "id",
      resultField: "childId",
      filter: { field: "parent", fromResultField: "parentId" },
    });
  });

  it("compiles widget authoring fields into the existing view-step model", () => {
    const definition = buildGuidedFlowDefinition({
      title: "Answer a question",
      steps: [
        {
          title: "Choose the answer",
          explanation: "Answer the question in the widget.",
          rendererSlug: "question-select",
          rendererVersion: 3,
          rendererDataJson: JSON.stringify({
            question: { taskId: "task-1", questionId: "question-2" },
          }),
          completionActionId: "correct",
        },
      ],
    });

    expect(viewStep(definition, 0)).toEqual({
      id: "step-1",
      title: "Choose the answer",
      explanation: "Answer the question in the widget.",
      rendererSlug: "question-select",
      rendererVersion: 3,
      rendererData: {
        question: { taskId: "task-1", questionId: "question-2" },
      },
      actions: [{ id: "correct", target: { type: "complete" } }],
    });
  });

  it("rejects invalid widget input without changing the runtime model", () => {
    expect(
      validateGuidedFlowDraft({
        title: "Broken widget",
        steps: [
          {
            title: "Widget",
            explanation: "Use it.",
            rendererSlug: "question-select",
            rendererDataJson: "{broken",
            completionActionId: "correct",
          },
        ],
      }),
    ).toEqual({ steps: "Enter valid JSON for every widget input." });
  });

  it("rejects an invalid widget finish signal", () => {
    expect(
      validateGuidedFlowDraft({
        title: "Broken widget",
        steps: [
          {
            title: "Widget",
            explanation: "Use it.",
            rendererSlug: "question-select",
            rendererDataJson: "{}",
            completionActionId: "Not valid",
          },
        ],
      }),
    ).toEqual({ steps: "Enter a valid finish signal for every widget." });
  });

  it("migrates legacy multi-select actions at the persistence boundary", () => {
    const definition = migrateLegacyGuidedFlowDefinition({
      id: "choose-items",
      version: 1,
      title: "Choose items",
      steps: [
        {
          id: "step-1",
          title: "Choose items",
          explanation: "Select items.",
          rendererSlug: "multi-select-list",
          transitions: { continue: "step-2" },
          allowedActions: ["continue"],
        },
        {
          id: "step-2",
          title: "Finish",
          explanation: "Finish.",
          rendererSlug: "approval-card",
        },
      ],
    });

    expect(definition.steps[0]).toMatchObject({
      actions: [{ id: "submit", target: { type: "step", stepId: "step-2" } }],
    });
  });

  it("rejects empty titles and flows without steps", () => {
    expect(validateGuidedFlowDraft({ ...validDraft, title: " " })).toEqual({
      title: "Enter a flow name.",
    });
    expect(validateGuidedFlowDraft({ ...validDraft, steps: [] })).toEqual({
      steps: "Add at least one step.",
    });
  });

  it("accepts custom renderer slugs and rejects malformed slugs", () => {
    expect(
      validateGuidedFlowDraft({
        ...validDraft,
        steps: [
          {
            title: "Custom",
            explanation: "Custom.",
            rendererSlug: "my-custom-renderer",
          },
        ],
      }),
    ).toEqual({});
    expect(
      validateGuidedFlowDraft({
        ...validDraft,
        steps: [
          {
            title: "Unknown",
            explanation: "Unknown.",
            rendererSlug: "not a valid slug",
          },
        ],
      }),
    ).toEqual({
      steps: "Choose a valid renderer or nested flow for every step.",
    });
  });
});
