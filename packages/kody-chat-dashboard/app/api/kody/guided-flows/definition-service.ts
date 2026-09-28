import { api as backendApi } from "@kody-ade/backend/api";
import type { createBackendClient } from "@kody-ade/backend/client";
import {
  buildGuidedFlowDefinition,
  type GuidedFlowDraft,
} from "@kody-ade/kody-chat-dashboard/guided-flows/authoring";
import {
  GuidedFlowCompositionError,
  validateGuidedFlowComposition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/composition";
import { pinGuidedFlowRendererVersions } from "@kody-ade/kody-chat-dashboard/guided-flows/compatibility";
import { listGuidedFlowDefinitions } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";
import {
  latestStoredGuidedFlowDefinitions,
  type StoredGuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/stored";
import {
  GuidedFlowDefinitionError,
  validateGuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/validation";
import {
  loadGuidedFlowRenderers,
  loadStoredGuidedFlowDefinitions,
} from "./catalog";
import { validateGuidedFlowNavigation } from "./navigation";

type BackendClient = ReturnType<typeof createBackendClient>;

export type GuidedFlowDefinitionCommandResult =
  | {
      readonly ok: true;
      readonly status: 200 | 201;
      readonly definition: StoredGuidedFlowDefinition;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 403 | 404 | 409;
      readonly error: string;
    };

function latestStoredDefinition(
  definitions: readonly StoredGuidedFlowDefinition[],
  flowId: string,
): StoredGuidedFlowDefinition | undefined {
  return latestStoredGuidedFlowDefinitions(definitions).find(
    (definition) => definition.id === flowId,
  );
}

export async function saveGuidedFlowDefinition(
  client: BackendClient,
  input: {
    readonly tenantId: string;
    readonly mode: "create" | "update";
    readonly flowId?: string;
    readonly draft: GuidedFlowDraft;
  },
): Promise<GuidedFlowDefinitionCommandResult> {
  const customDefinitions = await loadStoredGuidedFlowDefinitions(
    client,
    input.tenantId,
  );
  const nextVersion =
    (input.flowId
      ? latestStoredDefinition(customDefinitions, input.flowId)?.version
      : 0) ?? 0;
  const unpinnedDefinition = buildGuidedFlowDefinition(
    input.draft,
    input.flowId,
    nextVersion + 1,
  );
  const renderers = await loadGuidedFlowRenderers(input.tenantId, [
    unpinnedDefinition,
  ]);
  let candidateFlow;
  try {
    candidateFlow = pinGuidedFlowRendererVersions(
      unpinnedDefinition,
      renderers,
    );
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error:
        error instanceof Error &&
        error.message.startsWith("renderer_unavailable")
          ? "renderer_unavailable"
          : "renderer_contract_invalid",
    };
  }
  const candidate: StoredGuidedFlowDefinition = {
    ...candidateFlow,
  };
  const navigationError = validateGuidedFlowNavigation(candidateFlow);
  if (navigationError) {
    return { ok: false, status: 400, error: navigationError };
  }
  try {
    validateGuidedFlowDefinition(candidateFlow);
  } catch (error) {
    if (error instanceof GuidedFlowDefinitionError) {
      return { ok: false, status: 400, error: error.code };
    }
    throw error;
  }
  try {
    validateGuidedFlowComposition(candidateFlow, [
      ...listGuidedFlowDefinitions(),
      ...customDefinitions,
    ]);
  } catch (error) {
    if (error instanceof GuidedFlowCompositionError) {
      return { ok: false, status: 400, error: error.code };
    }
    throw error;
  }
  const builtins = listGuidedFlowDefinitions();
  if (
    input.flowId &&
    builtins.some((definition) => definition.id === input.flowId)
  ) {
    return {
      ok: false,
      status: 403,
      error: "builtin_guided_flow_read_only",
    };
  }
  if (builtins.some((definition) => definition.id === candidate.id)) {
    return {
      ok: false,
      status: 409,
      error: "guided_flow_already_exists",
    };
  }
  const version = (await client.mutation(
    backendApi.guidedFlows.saveDefinition,
    {
      tenantId: input.tenantId,
      flowId: candidate.id,
      mode: input.flowId && candidate.id === input.flowId ? "update" : "create",
      definition: candidate,
      updatedAt: new Date().toISOString(),
    },
  )) as number;
  return {
    ok: true,
    status: input.mode === "update" ? 200 : 201,
    definition: { ...candidate, version },
  };
}

export async function archiveGuidedFlowDefinition(
  client: BackendClient,
  input: { readonly tenantId: string; readonly flowId: string },
): Promise<GuidedFlowDefinitionCommandResult> {
  if (
    listGuidedFlowDefinitions().some(
      (definition) => definition.id === input.flowId,
    )
  ) {
    return {
      ok: false,
      status: 403,
      error: "builtin_guided_flow_read_only",
    };
  }
  const definitions = await loadStoredGuidedFlowDefinitions(
    client,
    input.tenantId,
  );
  const latest = latestStoredDefinition(definitions, input.flowId);
  if (!latest || latest.archived) {
    return { ok: false, status: 404, error: "guided_flow_not_found" };
  }
  const version = (await client.mutation(
    backendApi.guidedFlows.saveDefinition,
    {
      tenantId: input.tenantId,
      flowId: input.flowId,
      mode: "archive",
      definition: latest,
      updatedAt: new Date().toISOString(),
    },
  )) as number;
  return {
    ok: true,
    status: 200,
    definition: { ...latest, version, archived: true },
  };
}
