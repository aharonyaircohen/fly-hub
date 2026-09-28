import type { GuidedFlowDefinition } from "./model";

export type GuidedFlowDefinitionErrorCode =
  | "empty_flow"
  | "duplicate_step_id"
  | "empty_actions"
  | "duplicate_action_id"
  | "invalid_transition_target"
  | "renderer_action_mismatch";

export class GuidedFlowDefinitionError extends Error {
  constructor(
    readonly code: GuidedFlowDefinitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuidedFlowDefinitionError";
  }
}

function assertUnique(
  values: readonly string[],
  code: "duplicate_step_id" | "duplicate_action_id",
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new GuidedFlowDefinitionError(code, `Duplicate ${label}`);
  }
}

function rendererActionIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const id = (candidate as { id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
}

export function validateGuidedFlowDefinition(
  definition: GuidedFlowDefinition,
): void {
  if (definition.steps.length === 0) {
    throw new GuidedFlowDefinitionError(
      "empty_flow",
      "GuidedFlow must define at least one step",
    );
  }

  const stepIds = definition.steps.map((step) => step.id);
  assertUnique(stepIds, "duplicate_step_id", "GuidedFlow step id");
  const knownStepIds = new Set(stepIds);

  for (const step of definition.steps) {
    if (step.actions.length === 0) {
      throw new GuidedFlowDefinitionError(
        "empty_actions",
        `GuidedFlow step "${step.id}" must define an action`,
      );
    }
    const actionIds = step.actions.map((action) => action.id);
    assertUnique(
      actionIds,
      "duplicate_action_id",
      `action id on step "${step.id}"`,
    );
    for (const action of step.actions) {
      if (
        action.target.type === "step" &&
        !knownStepIds.has(action.target.stepId)
      ) {
        throw new GuidedFlowDefinitionError(
          "invalid_transition_target",
          `Action "${action.id}" on step "${step.id}" targets an unknown step`,
        );
      }
    }

    if (step.type === "flow" || step.type === "command") continue;
    const presentedActionIds = rendererActionIds(step.rendererData?.actions);
    if (
      presentedActionIds &&
      (presentedActionIds.length !== actionIds.length ||
        presentedActionIds.some((id) => !actionIds.includes(id)))
    ) {
      throw new GuidedFlowDefinitionError(
        "renderer_action_mismatch",
        `Renderer actions do not match step "${step.id}" actions`,
      );
    }
  }
}
