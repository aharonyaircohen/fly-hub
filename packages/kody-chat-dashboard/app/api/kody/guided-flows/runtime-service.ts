import { randomUUID } from "node:crypto";

import { api as backendApi } from "@kody-ade/backend/api";
import type { createBackendClient } from "@kody-ade/backend/client";
import { rootGuidedFlowId } from "@kody-ade/kody-chat-dashboard/guided-flows/composition";
import {
  guidedFlowDefinitionForInstance,
  guidedFlowDefinitionForReference,
} from "@kody-ade/kody-chat-dashboard/guided-flows/definitions";
import {
  guidedFlowInstanceFromRow,
  guidedFlowInstanceWriteFields,
  type GuidedFlowStoredInstance,
} from "@kody-ade/kody-chat-dashboard/guided-flows/persistence";
import { startGuidedFlowRuntime } from "@kody-ade/kody-chat-dashboard/guided-flows/runtime";
import { evaluateGuidedFlowCompatibility } from "@kody-ade/kody-chat-dashboard/guided-flows/compatibility";
import type {
  GuidedFlowDefinition,
  GuidedFlowInstance,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import type { StoredGuidedFlowDefinition } from "@kody-ade/kody-chat-dashboard/guided-flows/stored";
import {
  availableGuidedFlowDefinition,
  loadGuidedFlowRenderers,
  loadStoredGuidedFlowDefinitions,
} from "./catalog";

type BackendClient = ReturnType<typeof createBackendClient>;
type InstanceRow = GuidedFlowStoredInstance & {
  readonly mutationId?: string;
};

export interface GuidedFlowRuntimeSelection {
  readonly definition: GuidedFlowDefinition;
  readonly instance: GuidedFlowInstance;
  readonly storedDefinitions: readonly StoredGuidedFlowDefinition[];
  readonly created: boolean;
}

export async function bindGuidedFlowConversation(
  client: BackendClient,
  context: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly conversationId?: string;
    readonly instanceId: string;
  },
): Promise<void> {
  if (!context.conversationId) return;
  await client.mutation(backendApi.guidedFlows.bindConversation, {
    ...context,
    conversationId: context.conversationId,
    updatedAt: new Date().toISOString(),
  });
}

export async function startOrResumeGuidedFlow(
  client: BackendClient,
  input: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly flowId: string;
    readonly instanceKey?: string;
    readonly conversationId?: string;
  },
): Promise<GuidedFlowRuntimeSelection | null> {
  const storedDefinitions = await loadStoredGuidedFlowDefinitions(
    client,
    input.tenantId,
  );
  const definition = availableGuidedFlowDefinition(
    input.flowId,
    storedDefinitions,
  );
  if (!definition) return null;
  const entered = startGuidedFlowRuntime({
    definition,
    instanceId: randomUUID(),
    instanceKey: input.instanceKey,
    resolveDefinition: (flowId, flowVersion) =>
      guidedFlowDefinitionForReference(flowId, flowVersion, storedDefinitions),
  });
  const renderers = await loadGuidedFlowRenderers(input.tenantId, [
    entered.definition,
  ]);
  const compatibility = evaluateGuidedFlowCompatibility({
    definition: entered.definition,
    instance: entered.instance,
    renderers,
  });
  if (compatibility.status !== "compatible") {
    throw new Error(compatibility.code);
  }
  const selected = (await client.mutation(
    backendApi.guidedFlows.startOrResume,
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      rootFlowId: rootGuidedFlowId(entered.instance),
      restart: true,
      ...guidedFlowInstanceWriteFields(entered.instance),
      updatedAt: new Date().toISOString(),
    },
  )) as { created: boolean; instance: InstanceRow };
  const instance = guidedFlowInstanceFromRow(selected.instance);
  await bindGuidedFlowConversation(client, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    conversationId: input.conversationId,
    instanceId: instance.instanceId,
  });
  return {
    definition: guidedFlowDefinitionForInstance(
      selected.instance,
      storedDefinitions,
    ),
    instance,
    storedDefinitions,
    created: selected.created,
  };
}

export async function bindExistingGuidedFlow(
  client: BackendClient,
  input: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly conversationId: string;
    readonly instanceId: string;
  },
): Promise<GuidedFlowRuntimeSelection | null> {
  const row = (await client.query(backendApi.guidedFlows.get, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    instanceId: input.instanceId,
  })) as InstanceRow | null;
  if (!row) return null;
  await bindGuidedFlowConversation(client, input);
  const storedDefinitions = await loadStoredGuidedFlowDefinitions(
    client,
    input.tenantId,
  );
  return {
    definition: guidedFlowDefinitionForInstance(row, storedDefinitions),
    instance: guidedFlowInstanceFromRow(row),
    storedDefinitions,
    created: false,
  };
}
