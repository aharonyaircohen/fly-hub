import {
  advanceGuidedFlow,
  cancelGuidedFlow,
  createGuidedFlowInstance,
  getGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
  type GuidedFlowFrame,
  type GuidedFlowInstance,
} from "./controller";
import { GuidedFlowCompositionError } from "./errors";

export const MAX_GUIDED_FLOW_DEPTH = 8;

export { GuidedFlowCompositionError } from "./errors";

function frameFor(instance: GuidedFlowInstance): GuidedFlowFrame {
  return {
    flowId: instance.flowId,
    flowVersion: instance.flowVersion,
    currentStepId: instance.currentStepId,
    data: instance.data,
    backStack: instance.backStack,
  };
}

function lineage(instance: GuidedFlowInstance): readonly GuidedFlowFrame[] {
  return [...instance.stack, frameFor(instance)];
}

export function rootGuidedFlowId(instance: GuidedFlowInstance): string {
  return instance.stack[0]?.flowId ?? instance.flowId;
}

export function cancelGuidedFlowTree(
  instance: GuidedFlowInstance,
): GuidedFlowInstance {
  if (instance.stack.length === 0) return cancelGuidedFlow(instance);
  const root = instance.stack[0];
  return {
    ...instance,
    ...root,
    status: "cancelled",
    revision: instance.revision + 1,
    output: {},
    stack: [],
  };
}

export function enterNestedGuidedFlow(
  parentDefinition: GuidedFlowDefinition,
  parent: GuidedFlowInstance,
  childDefinition: GuidedFlowDefinition,
): GuidedFlowInstance {
  const step = getGuidedFlowStep(parentDefinition, parent);
  if (!isNestedGuidedFlowStep(step)) {
    throw new GuidedFlowCompositionError(
      "step_not_nested",
      `GuidedFlow step "${step.id}" is not a nested flow`,
    );
  }
  if (
    step.flowId !== childDefinition.id ||
    step.flowVersion !== childDefinition.version
  ) {
    throw new GuidedFlowCompositionError(
      "nested_definition_mismatch",
      "Nested GuidedFlow definition does not match the step",
    );
  }
  const currentLineage = lineage(parent);
  if (currentLineage.length >= MAX_GUIDED_FLOW_DEPTH) {
    throw new GuidedFlowCompositionError(
      "nesting_depth_exceeded",
      "GuidedFlow nesting depth exceeded",
    );
  }
  if (
    currentLineage.some(
      (frame) =>
        frame.flowId === childDefinition.id &&
        frame.flowVersion === childDefinition.version,
    )
  ) {
    throw new GuidedFlowCompositionError(
      "recursive_flow",
      "GuidedFlow nesting cannot be recursive",
    );
  }

  const child = createGuidedFlowInstance(
    childDefinition,
    parent.instanceId,
    parent.instanceKey,
  );
  return {
    ...child,
    revision: parent.revision,
    stack: [...parent.stack, frameFor(parent)],
  };
}

export function enterNestedGuidedFlows(
  initialDefinition: GuidedFlowDefinition,
  initialInstance: GuidedFlowInstance,
  resolveDefinition: (
    flowId: string,
    flowVersion: number,
  ) => GuidedFlowDefinition | null,
): {
  definition: GuidedFlowDefinition;
  instance: GuidedFlowInstance;
} {
  let definition = initialDefinition;
  let instance = initialInstance;
  while (instance.status === "active") {
    const step = getGuidedFlowStep(definition, instance);
    if (!isNestedGuidedFlowStep(step)) break;
    const childDefinition = resolveDefinition(step.flowId, step.flowVersion);
    if (!childDefinition) {
      throw new GuidedFlowCompositionError(
        "nested_flow_unavailable",
        `Nested GuidedFlow "${step.flowId}" version ${step.flowVersion} is unavailable`,
      );
    }
    instance = enterNestedGuidedFlow(definition, instance, childDefinition);
    definition = childDefinition;
  }
  return { definition, instance };
}

function flowResults(parent: GuidedFlowFrame): Record<string, unknown> {
  const current = parent.data.flowResults;
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
}

export function resumeParentGuidedFlow(
  parentDefinition: GuidedFlowDefinition,
  child: GuidedFlowInstance,
): GuidedFlowInstance {
  if (child.status !== "completed") {
    throw new GuidedFlowCompositionError(
      "child_not_completed",
      "Nested GuidedFlow must complete before its parent resumes",
    );
  }
  const parent = child.stack.at(-1);
  if (!parent) {
    throw new GuidedFlowCompositionError(
      "parent_not_waiting",
      "Nested GuidedFlow has no parent",
    );
  }
  if (
    parent.flowId !== parentDefinition.id ||
    parent.flowVersion !== parentDefinition.version
  ) {
    throw new GuidedFlowCompositionError(
      "parent_definition_mismatch",
      "Parent GuidedFlow definition does not match the stack",
    );
  }
  const parentInstance: GuidedFlowInstance = {
    instanceId: child.instanceId,
    ...(child.instanceKey ? { instanceKey: child.instanceKey } : {}),
    ...parent,
    status: "active",
    revision: child.revision - 1,
    output: {},
    stack: child.stack.slice(0, -1),
  };
  const step = getGuidedFlowStep(parentDefinition, parentInstance);
  if (!isNestedGuidedFlowStep(step)) {
    throw new GuidedFlowCompositionError(
      "parent_not_waiting",
      `GuidedFlow step "${step.id}" is not waiting for a flow`,
    );
  }
  const resumed = advanceGuidedFlow(parentDefinition, parentInstance, {
    actionId: "complete",
    result: {
      flowResults: {
        ...flowResults(parent),
        [step.id]: {
          flowId: child.flowId,
          flowVersion: child.flowVersion,
          status: child.status,
          output: child.output,
        },
      },
    },
  });
  return { ...resumed, revision: child.revision };
}

export function validateGuidedFlowComposition(
  definition: GuidedFlowDefinition,
  availableDefinitions: readonly GuidedFlowDefinition[],
): void {
  const definitions = new Map(
    [...availableDefinitions, definition].map((candidate) => [
      `${candidate.id}@${candidate.version}`,
      candidate,
    ]),
  );

  const visit = (
    current: GuidedFlowDefinition,
    lineage: readonly string[],
  ): void => {
    const key = `${current.id}@${current.version}`;
    if (lineage.includes(key)) {
      throw new GuidedFlowCompositionError(
        "recursive_flow",
        "GuidedFlow composition cannot be recursive",
      );
    }
    if (lineage.length >= MAX_GUIDED_FLOW_DEPTH) {
      throw new GuidedFlowCompositionError(
        "nesting_depth_exceeded",
        "GuidedFlow composition exceeds the nesting limit",
      );
    }
    const nextLineage = [...lineage, key];
    for (const step of current.steps) {
      if (!isNestedGuidedFlowStep(step)) continue;
      const child = definitions.get(`${step.flowId}@${step.flowVersion}`);
      if (!child) {
        throw new GuidedFlowCompositionError(
          "nested_flow_unavailable",
          `Nested GuidedFlow "${step.flowId}" version ${step.flowVersion} is unavailable`,
        );
      }
      visit(child, nextLineage);
    }
  };

  visit(definition, []);
}
