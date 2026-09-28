import { z } from "zod";
import type { NextRequest } from "next/server";

import { api as backendApi } from "@kody-ade/backend/api";
import type { createBackendClient } from "@kody-ade/backend/client";
import { guidedFlowInternalJsonHeaders } from "./internal-request-headers";

type BackendClient = ReturnType<typeof createBackendClient>;

interface GuidedFlowEffectRow {
  readonly instanceId: string;
  readonly effectId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly action?: string;
  readonly data: unknown;
  readonly attempts: number;
}

function blueprintIdFromInstanceKey(instanceKey?: string): string | undefined {
  const match = /^blueprint:([a-z][a-z0-9-]{0,127})$/.exec(
    instanceKey?.trim() ?? "",
  );
  return match?.[1];
}

interface GuidedFlowHandoff {
  readonly type: "kody";
  readonly message: string;
  readonly displayContent: string;
}

export class GuidedFlowCompletionError extends Error {
  constructor(
    readonly code:
      | "guided_flow_workflow_exists"
      | "guided_flow_invalid_workflow"
      | "guided_flow_auth_failed"
      | "guided_flow_rate_limited"
      | "guided_flow_completion_failed",
    readonly status: number,
  ) {
    super(code);
  }
}

function completionErrorFor(
  errorCode: string | undefined,
  status: number,
): GuidedFlowCompletionError {
  if (errorCode === "workflow_exists") {
    return new GuidedFlowCompletionError("guided_flow_workflow_exists", 409);
  }
  if (errorCode === "invalid_workflow" || errorCode === "invalid_body") {
    return new GuidedFlowCompletionError("guided_flow_invalid_workflow", 400);
  }
  if (errorCode === "github_token_expired") {
    return new GuidedFlowCompletionError("guided_flow_auth_failed", 401);
  }
  if (errorCode === "rate_limited") {
    return new GuidedFlowCompletionError("guided_flow_rate_limited", 429);
  }
  return new GuidedFlowCompletionError(
    "guided_flow_completion_failed",
    status >= 400 && status < 500 ? status : 502,
  );
}

async function createWorkflowEffect(
  req: NextRequest,
  effect: GuidedFlowEffectRow,
  actor: string,
  isRetry: boolean,
): Promise<unknown> {
  const input = z
    .object({
      workflowName: z.string().trim().min(1).max(160),
      capabilitySlug: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
      actionId: z.literal("approve"),
    })
    .safeParse(effect.data);
  if (!input.success) {
    throw new GuidedFlowCompletionError("guided_flow_invalid_workflow", 400);
  }
  const headers = guidedFlowInternalJsonHeaders(req, effect.effectId);
  const response = await fetch(
    new URL("/api/kody/company/workflows", req.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: input.data.workflowName,
        capabilities: [input.data.capabilitySlug],
        actorLogin: actor,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    workflow?: unknown;
    error?: string;
  };
  // A retry after the workflow was created but before the effect was marked
  // complete reaches the existing unique-name guard. That is success here.
  if (
    isRetry &&
    response.status === 409 &&
    payload.error === "workflow_exists"
  ) {
    return undefined;
  }
  if (!response.ok) throw completionErrorFor(payload.error, response.status);
  return payload.workflow;
}

async function runConsumerEffect(
  req: NextRequest,
  effect: GuidedFlowEffectRow,
  actor: string,
  isRetry: boolean,
  instanceKey?: string,
): Promise<{ workflow?: unknown; handoff?: GuidedFlowHandoff }> {
  if (effect.action === "agency-request.submit") {
    const headers = guidedFlowInternalJsonHeaders(req, effect.effectId);
    const response = await fetch(
      new URL("/api/kody/agency-requests", req.url),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(blueprintIdFromInstanceKey(instanceKey)
            ? { blueprintId: blueprintIdFromInstanceKey(instanceKey) }
            : {}),
          source: {
            kind: "guided-flow",
            instanceId: effect.instanceId,
            effectId: effect.effectId,
            flowId: effect.flowId,
          },
          answers: effect.data,
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      handoff?: GuidedFlowHandoff;
      error?: string;
    };
    if (!response.ok || !payload.handoff) {
      throw completionErrorFor(payload.error, response.status);
    }
    return { handoff: payload.handoff };
  }
  if (effect.flowId === "create-workflow") {
    return {
      workflow: await createWorkflowEffect(req, effect, actor, isRetry),
    };
  }
  return {};
}

export async function processGuidedFlowCompletionEffects(
  req: NextRequest,
  client: BackendClient,
  input: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly instanceId: string;
    readonly instanceKey?: string;
  },
): Promise<{
  readonly workflow?: unknown;
  readonly handoff?: GuidedFlowHandoff;
}> {
  const effects = (await client.query(
    backendApi.guidedFlows.listPendingEffects,
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      instanceId: input.instanceId,
    },
  )) as GuidedFlowEffectRow[];
  let workflow: unknown;
  let handoff: GuidedFlowHandoff | undefined;
  for (const effect of effects) {
    try {
      await client.mutation(backendApi.guidedFlows.beginEffect, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        effectId: effect.effectId,
        updatedAt: new Date().toISOString(),
      });
      const result = await runConsumerEffect(
        req,
        effect,
        input.actorId,
        effect.attempts > 0,
        input.instanceKey,
      );
      workflow = result.workflow ?? workflow;
      handoff = result.handoff ?? handoff;
      await client.mutation(backendApi.guidedFlows.markEffect, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        effectId: effect.effectId,
        status: "completed",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await client.mutation(backendApi.guidedFlows.markEffect, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        effectId: effect.effectId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Effect failed",
      });
      throw error;
    }
  }
  return {
    ...(workflow === undefined ? {} : { workflow }),
    ...(handoff ? { handoff } : {}),
  };
}
