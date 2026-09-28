import type {
  GuidedFlowActionDefinition,
  GuidedFlowCommandStepDefinition,
  GuidedFlowCmsItemsSource,
  GuidedFlowDefinition,
  GuidedFlowInstance,
  GuidedFlowNestedStepDefinition,
  GuidedFlowStepDefinition,
  GuidedFlowSubmit,
} from "./model";
import { sanitizeGuidedFlowData } from "./safe-data";

export type {
  GuidedFlowDefinition,
  GuidedFlowActionDefinition,
  GuidedFlowActionTarget,
  GuidedFlowCommandStepDefinition,
  GuidedFlowFrame,
  GuidedFlowInstance,
  GuidedFlowNestedStepDefinition,
  GuidedFlowStatus,
  GuidedFlowStepBase,
  GuidedFlowStepDefinition,
  GuidedFlowSubmit,
  GuidedFlowViewStepDefinition,
} from "./model";

function findStep(
  definition: GuidedFlowDefinition,
  stepId: string,
): GuidedFlowStepDefinition {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Unknown GuidedFlow step "${stepId}"`);
  return step;
}

function findAction(
  step: GuidedFlowStepDefinition,
  actionId: string,
): GuidedFlowActionDefinition {
  const action = step.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw new Error(`Unknown action "${actionId}" from step "${step.id}"`);
  }
  return action;
}

export function getGuidedFlowStep(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
): GuidedFlowStepDefinition {
  assertDefinitionMatches(definition, instance);
  return findStep(definition, instance.currentStepId);
}

function assertActive(instance: GuidedFlowInstance): void {
  if (instance.status !== "active") {
    throw new Error(`GuidedFlow instance is not active (${instance.status})`);
  }
}

function assertDefinitionMatches(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
): void {
  if (
    instance.flowId !== definition.id ||
    instance.flowVersion !== definition.version
  ) {
    throw new Error("GuidedFlow definition version does not match instance");
  }
}

export function createGuidedFlowInstance(
  definition: GuidedFlowDefinition,
  instanceId: string,
  instanceKey?: string,
): GuidedFlowInstance {
  const firstStep = definition.steps[0];
  if (!firstStep) throw new Error("GuidedFlow must define at least one step");
  if (!instanceId.trim()) throw new Error("GuidedFlow instanceId is required");

  return {
    instanceId,
    ...(instanceKey ? { instanceKey } : {}),
    flowId: definition.id,
    flowVersion: definition.version,
    currentStepId: firstStep.id,
    status: "active",
    revision: 0,
    data: {},
    output: {},
    backStack: [],
    stack: [],
  };
}

export function advanceGuidedFlow(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
  submit: GuidedFlowSubmit,
): GuidedFlowInstance {
  assertActive(instance);
  assertDefinitionMatches(definition, instance);
  if (!submit.actionId.trim())
    throw new Error("GuidedFlow actionId is required");

  const step = findStep(definition, instance.currentStepId);
  const action = findAction(step, submit.actionId);
  const result = sanitizeGuidedFlowData(submit.result);
  const stepResultKey = `${definition.id}@${definition.version}/${step.id}`;
  const existingStepResults =
    instance.data.stepResults &&
    typeof instance.data.stepResults === "object" &&
    !Array.isArray(instance.data.stepResults)
      ? (instance.data.stepResults as Readonly<Record<string, unknown>>)
      : {};
  const nextData = {
    ...instance.data,
    ...result,
    actionId: submit.actionId,
    stepResults: {
      ...existingStepResults,
      [stepResultKey]: {
        actionId: submit.actionId,
        result,
      },
    },
  };

  if (action.target.type === "complete") {
    return {
      ...instance,
      status: "completed",
      revision: instance.revision + 1,
      data: nextData,
      output: result,
    };
  }

  if (action.target.type === "cancel") {
    return {
      ...instance,
      status: "cancelled",
      revision: instance.revision + 1,
      data: nextData,
    };
  }
  if (action.target.type === "stay") {
    return {
      ...instance,
      revision: instance.revision + 1,
      data: nextData,
    };
  }
  const nextStepId = action.target.stepId;
  findStep(definition, nextStepId);

  return {
    ...instance,
    currentStepId: nextStepId,
    revision: instance.revision + 1,
    data: nextData,
    backStack: [...instance.backStack, step.id],
  };
}

export function goBackGuidedFlow(
  definition: GuidedFlowDefinition,
  instance: GuidedFlowInstance,
): GuidedFlowInstance {
  assertActive(instance);
  assertDefinitionMatches(definition, instance);
  const previousStepId = instance.backStack.at(-1);
  if (!previousStepId)
    throw new Error("GuidedFlow is already at its first step");
  findStep(definition, previousStepId);

  return {
    ...instance,
    currentStepId: previousStepId,
    revision: instance.revision + 1,
    backStack: instance.backStack.slice(0, -1),
  };
}

export function cancelGuidedFlow(
  instance: GuidedFlowInstance,
): GuidedFlowInstance {
  assertActive(instance);
  return {
    ...instance,
    status: "cancelled",
    revision: instance.revision + 1,
  };
}

export function isNestedGuidedFlowStep(
  step: GuidedFlowStepDefinition,
): step is GuidedFlowNestedStepDefinition {
  return step.type === "flow";
}

export function isCommandGuidedFlowStep(
  step: GuidedFlowStepDefinition,
): step is GuidedFlowCommandStepDefinition {
  return step.type === "command";
}
