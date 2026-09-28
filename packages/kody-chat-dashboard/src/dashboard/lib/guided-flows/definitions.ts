import type { GuidedFlowDefinition } from "./controller";
import { getGuidedFlowDefinition } from "./registry";
import type { StoredGuidedFlowDefinition } from "./stored";

export function guidedFlowDefinitionForReference(
  flowId: string,
  flowVersion: number,
  repositoryDefinitions: readonly StoredGuidedFlowDefinition[],
): GuidedFlowDefinition | null {
  const repositoryDefinition = repositoryDefinitions.find(
    (definition) =>
      definition.id === flowId && definition.version === flowVersion,
  );
  if (repositoryDefinition) {
    const { archived: _archived, ...definition } = repositoryDefinition;
    return definition;
  }
  return getGuidedFlowDefinition(flowId, flowVersion);
}

export function guidedFlowDefinitionForInstance(
  instance: { flowId: string; flowVersion: number },
  repositoryDefinitions: readonly StoredGuidedFlowDefinition[],
): GuidedFlowDefinition {
  const definition = guidedFlowDefinitionForReference(
    instance.flowId,
    instance.flowVersion,
    repositoryDefinitions,
  );
  if (!definition) {
    throw new Error("GuidedFlow definition is no longer available");
  }
  return definition;
}
