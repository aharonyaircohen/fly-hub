import {
  advanceGuidedFlow,
  createGuidedFlowInstance,
  goBackGuidedFlow,
  type GuidedFlowDefinition,
  type GuidedFlowInstance,
  type GuidedFlowSubmit,
} from "./controller";
import {
  cancelGuidedFlowTree,
  enterNestedGuidedFlows,
  GuidedFlowCompositionError,
  resumeParentGuidedFlow,
} from "./composition";

export type GuidedFlowDefinitionResolver = (
  flowId: string,
  flowVersion: number,
) => GuidedFlowDefinition | null;

export interface GuidedFlowRuntimeState {
  definition: GuidedFlowDefinition;
  instance: GuidedFlowInstance;
}

export interface GuidedFlowRuntimeResult extends GuidedFlowRuntimeState {
  completed: readonly GuidedFlowRuntimeState[];
}

export function startGuidedFlowRuntime({
  definition,
  instanceId,
  instanceKey,
  resolveDefinition,
}: {
  definition: GuidedFlowDefinition;
  instanceId: string;
  instanceKey?: string;
  resolveDefinition: GuidedFlowDefinitionResolver;
}): GuidedFlowRuntimeState {
  return enterNestedGuidedFlows(
    definition,
    createGuidedFlowInstance(definition, instanceId, instanceKey),
    resolveDefinition,
  );
}

export function runGuidedFlowAction({
  definition: initialDefinition,
  instance,
  action,
  actionId,
  result,
  resolveDefinition,
}: {
  definition: GuidedFlowDefinition;
  instance: GuidedFlowInstance;
  action: "back" | "cancel" | "submit";
  actionId?: string;
  result?: GuidedFlowSubmit["result"];
  resolveDefinition: GuidedFlowDefinitionResolver;
}): GuidedFlowRuntimeResult {
  let definition = initialDefinition;
  let next =
    action === "back"
      ? goBackGuidedFlow(definition, instance)
      : action === "cancel"
        ? cancelGuidedFlowTree(instance)
        : advanceGuidedFlow(definition, instance, {
            actionId: actionId ?? "",
            result,
          });
  if (next.status === "cancelled" && next.stack.length > 0) {
    next = cancelGuidedFlowTree(instance);
  }
  const completed: GuidedFlowRuntimeState[] = [];

  if (action === "submit") {
    while (next.status === "completed") {
      completed.push({ definition, instance: next });
      const parent = next.stack.at(-1);
      if (!parent) break;
      const parentDefinition = resolveDefinition(
        parent.flowId,
        parent.flowVersion,
      );
      if (!parentDefinition) {
        throw new GuidedFlowCompositionError(
          "parent_flow_unavailable",
          `Parent GuidedFlow "${parent.flowId}" version ${parent.flowVersion} is unavailable`,
        );
      }
      next = resumeParentGuidedFlow(parentDefinition, next);
      definition = parentDefinition;
    }
  }

  if (next.status === "active") {
    const entered = enterNestedGuidedFlows(definition, next, resolveDefinition);
    definition = entered.definition;
    next = entered.instance;
  }

  return { definition, instance: next, completed };
}
