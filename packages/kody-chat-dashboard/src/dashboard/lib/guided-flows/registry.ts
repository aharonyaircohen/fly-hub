import type { GuidedFlowDefinition } from "./controller";
import {
  BUILTIN_GUIDED_FLOW_DEFINITIONS,
  BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS,
} from "./builtins";
import type { RequestBlueprintDefinition } from "../request-blueprints";
import { validateGuidedFlowDefinition } from "./validation";

for (const definition of BUILTIN_GUIDED_FLOW_DEFINITIONS) {
  validateGuidedFlowDefinition(definition);
}

export {
  CREATE_WORKFLOW_FLOW_ID,
  INITIALIZE_KODY_ENGINE_FLOW_ID,
  ONBOARDING_FLOW_ID,
  SETUP_UI_LOGIN_FLOW_ID,
} from "./builtins";
export { buildGuidedFlowStatusView, buildGuidedFlowView } from "./presentation";

export function getGuidedFlowDefinition(
  flowId: string,
  version?: number,
): GuidedFlowDefinition | null {
  const matches = BUILTIN_GUIDED_FLOW_DEFINITIONS.filter(
    (definition) =>
      definition.id === flowId &&
      (version === undefined || definition.version === version),
  );
  return (
    matches.reduce<GuidedFlowDefinition | null>(
      (latest, definition) =>
        !latest || definition.version > latest.version ? definition : latest,
      null,
    ) ?? null
  );
}

export function listGuidedFlowDefinitions(): readonly GuidedFlowDefinition[] {
  const latestById = new Map<string, GuidedFlowDefinition>();
  for (const definition of BUILTIN_GUIDED_FLOW_DEFINITIONS) {
    const latest = latestById.get(definition.id);
    if (!latest || definition.version > latest.version) {
      latestById.set(definition.id, definition);
    }
  }
  return [...latestById.values()];
}

export function listRequestBlueprintDefinitions(): readonly RequestBlueprintDefinition[] {
  const latestById = new Map<string, RequestBlueprintDefinition>();
  for (const definition of BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS) {
    const latest = latestById.get(definition.id);
    if (!latest || definition.version > latest.version) {
      latestById.set(definition.id, definition);
    }
  }
  return [...latestById.values()];
}

export function getRequestBlueprintDefinition(
  flowId: string,
  version: number,
): RequestBlueprintDefinition | null {
  return (
    BUILTIN_REQUEST_BLUEPRINT_DEFINITIONS.find(
      (definition) =>
        definition.id === flowId && definition.version === version,
    ) ?? null
  );
}
