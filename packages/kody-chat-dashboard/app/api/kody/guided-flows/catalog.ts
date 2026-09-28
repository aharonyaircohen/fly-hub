import { api as backendApi } from "@kody-ade/backend/api";
import type { createBackendClient } from "@kody-ade/backend/client";
import {
  isCommandGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import {
  getGuidedFlowDefinition,
  listGuidedFlowDefinitions,
  ONBOARDING_FLOW_ID,
} from "@kody-ade/kody-chat-dashboard/guided-flows/registry";
import {
  latestAvailableGuidedFlowDefinitions,
  parseGuidedFlowDefinitionRows,
  type StoredGuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/stored";
import { getBuiltinViewRendererDefinition } from "../../../../src/dashboard/lib/view-renderers/builtin";
import type { ViewRendererDefinition } from "../../../../src/dashboard/lib/view-renderers/definition";
import { readViewRendererDefinitionFile } from "../../../../src/dashboard/lib/view-renderers/standalone-renderer-store";

type BackendClient = ReturnType<typeof createBackendClient>;

export async function loadStoredGuidedFlowDefinitions(
  client: BackendClient,
  tenantId: string,
): Promise<StoredGuidedFlowDefinition[]> {
  const rows = await client.query(backendApi.guidedFlows.listDefinitions, {
    tenantId,
  });
  return parseGuidedFlowDefinitionRows(rows);
}

export function availableGuidedFlowDefinitions(
  stored: readonly StoredGuidedFlowDefinition[],
): GuidedFlowDefinition[] {
  const builtIn = listGuidedFlowDefinitions();
  const reservedIds = new Set(builtIn.map((definition) => definition.id));
  return [
    ...builtIn,
    ...latestAvailableGuidedFlowDefinitions(stored).filter(
      (definition) => !reservedIds.has(definition.id),
    ),
  ];
}

export function availableUserGuidedFlowDefinitions(): GuidedFlowDefinition[] {
  return listGuidedFlowDefinitions().filter(
    (definition) => definition.id === ONBOARDING_FLOW_ID,
  );
}

export function availableGuidedFlowDefinition(
  flowId: string,
  stored: readonly StoredGuidedFlowDefinition[],
): GuidedFlowDefinition | undefined {
  return (
    getGuidedFlowDefinition(flowId) ??
    latestAvailableGuidedFlowDefinitions(stored).find(
      (definition) => definition.id === flowId,
    )
  );
}

export async function loadGuidedFlowRenderers(
  tenantId: string,
  definitions: readonly GuidedFlowDefinition[],
): Promise<Record<string, ViewRendererDefinition>> {
  const [owner, repo] = tenantId.split("/");
  if (!owner || !repo) return {};
  const references = [
    ...new Map(
      definitions
        .flatMap((definition) => definition.steps)
        .flatMap((step) =>
          isNestedGuidedFlowStep(step) || isCommandGuidedFlowStep(step)
            ? []
            : [step],
        )
        .filter((step) => !getBuiltinViewRendererDefinition(step.rendererSlug))
        .map((step) => [
          `${step.rendererSlug}@${step.rendererVersion ?? "latest"}`,
          {
            slug: step.rendererSlug,
            version: step.rendererVersion,
          },
        ]),
    ).values(),
  ];
  const renderers: Record<string, ViewRendererDefinition> = {};
  for (const reference of references) {
    const file = await readViewRendererDefinitionFile({
      owner,
      repo,
      slug: reference.slug,
      version: reference.version,
    });
    if (file) {
      renderers[
        `${reference.slug}@${reference.version ?? file.definition.version ?? 1}`
      ] = file.definition;
      if (reference.version === undefined) {
        renderers[reference.slug] = file.definition;
      }
    }
  }
  return renderers;
}
