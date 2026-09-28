import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getUserRequestAuth,
  getRequestAuth,
  requireKodyAuth,
  requireUserAuth,
  verifyActorLogin,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  getGuidedFlowStep,
  isCommandGuidedFlowStep,
  type GuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import { GUIDED_FLOW_CONTROL_IDS } from "@kody-ade/kody-chat-dashboard/guided-flows/control-contract";
import { guidedFlowDraftSchema } from "@kody-ade/kody-chat-dashboard/guided-flows/authoring";
import {
  executeGuidedFlowControl,
  GuidedFlowControlError,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controls";
import { GuidedFlowCompositionError } from "@kody-ade/kody-chat-dashboard/guided-flows/composition";
import {
  guidedFlowDefinitionForInstance,
  guidedFlowDefinitionForReference,
} from "@kody-ade/kody-chat-dashboard/guided-flows/definitions";
import {
  guidedFlowInstanceFromRow,
  guidedFlowInstanceWriteFields,
  type GuidedFlowStoredInstance,
} from "@kody-ade/kody-chat-dashboard/guided-flows/persistence";
import { runGuidedFlowAction } from "@kody-ade/kody-chat-dashboard/guided-flows/runtime";
import type { StoredGuidedFlowDefinition } from "@kody-ade/kody-chat-dashboard/guided-flows/stored";
import { sanitizeGuidedFlowData } from "@kody-ade/kody-chat-dashboard/guided-flows/safe-data";
import { guidedFlowStepResult } from "@kody-ade/kody-chat-dashboard/guided-flows/step-results";
import { ONBOARDING_FLOW_ID } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";
import {
  availableGuidedFlowDefinitions,
  loadGuidedFlowRenderers,
  loadStoredGuidedFlowDefinitions,
} from "./catalog";
import {
  bindExistingGuidedFlow,
  startOrResumeGuidedFlow,
} from "./runtime-service";
import {
  GuidedFlowCompletionError,
  processGuidedFlowCompletionEffects,
} from "./completion-effects";
import { presentGuidedFlow } from "./presenter";
import {
  archiveGuidedFlowDefinition,
  saveGuidedFlowDefinition,
} from "./definition-service";
import {
  readGuidedFlowBootstrapScope,
  setGuidedFlowBootstrapCookie,
  type GuidedFlowBootstrapScope,
} from "./bootstrap-scope";
import {
  executeGuidedFlowCommand,
  GuidedFlowCommandError,
  refreshGuidedFlowCommand,
} from "./command-execution";
import { getChatRequestContextProvider } from "../chat/request-context-provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getConvexClient = createBackendClient;

function tenantIdFor(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function userTenantIdFor(githubId: number): string {
  return `user:${githubId}`;
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const conversationIdSchema = z.string().trim().min(1).max(128);

const startSchema = z.object({
  action: z.literal("start"),
  flowId: z.string().trim().min(1).max(80),
  instanceKey: z.string().trim().min(1).max(128).optional(),
  actorLogin: z.string().trim().min(1).max(200).optional(),
  conversationId: conversationIdSchema.optional(),
});

const bindSchema = z.object({
  action: z.literal("bind"),
  instanceId: z.string().trim().min(1).max(128),
  conversationId: conversationIdSchema,
});

const createDefinitionSchema = z.object({
  action: z.literal("create-definition"),
  draft: guidedFlowDraftSchema,
});

const updateDefinitionSchema = z.object({
  action: z.literal("update-definition"),
  flowId: z.string().trim().min(1).max(80),
  draft: guidedFlowDraftSchema,
});

const deleteDefinitionSchema = z.object({
  action: z.literal("delete-definition"),
  flowId: z.string().trim().min(1).max(80),
});

const changeSchema = z.object({
  action: z.enum(["submit", "cancel", "control", "sync-command"]),
  instanceId: z.string().trim().min(1).max(128),
  stepId: z.string().trim().min(1).max(80).optional(),
  actionId: z.string().trim().min(1).max(80).optional(),
  controlId: z.enum(GUIDED_FLOW_CONTROL_IDS).optional(),
  expectedRevision: z.number().int().nonnegative(),
  result: z.record(z.string(), z.unknown()).optional(),
  mutationId: z.string().trim().min(1).max(128),
});

type GuidedFlowRow = GuidedFlowStoredInstance & {
  tenantId: string;
  actorId: string;
  updatedAt: string;
  mutationId?: string;
};

interface GuidedFlowRequestScope {
  readonly tenantId: string;
  readonly actorId: string;
  readonly kind: "user" | "repository" | "bootstrap";
  readonly bootstrap?: GuidedFlowBootstrapScope;
  readonly instanceRow?: GuidedFlowRow;
}

function requestScopeForBootstrap(
  bootstrap: GuidedFlowBootstrapScope,
): GuidedFlowRequestScope {
  return {
    tenantId: bootstrap.tenantId,
    actorId: bootstrap.actorId,
    kind: "bootstrap",
    bootstrap,
  };
}

function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) },
  });
}

function requireRepo(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) return json({ error: "missing_repo_context" }, { status: 400 });
  return auth;
}

async function actorFor(req: NextRequest, actorLogin?: string) {
  const actor = await verifyActorLogin(req, actorLogin);
  if (actor instanceof NextResponse) return actor;
  return actor.identity.login;
}

async function repositoryScope(
  req: NextRequest,
  actorLogin?: string,
): Promise<GuidedFlowRequestScope | NextResponse> {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  const auth = requireRepo(req);
  if (auth instanceof NextResponse) return auth;
  const actor = await actorFor(req, actorLogin);
  if (actor instanceof NextResponse) return actor;
  return {
    tenantId: tenantIdFor(auth.owner, auth.repo),
    actorId: actor,
    kind: "repository",
  };
}

async function userScope(
  req: NextRequest,
  actorLogin?: string,
): Promise<GuidedFlowRequestScope | NextResponse> {
  const hostUser = await getChatRequestContextProvider()?.resolveUser(req);
  if (hostUser) {
    return {
      tenantId: `user:${hostUser.id}`,
      actorId: hostUser.id,
      kind: "user",
    };
  }
  const authError = await requireUserAuth(req);
  if (authError) return authError;
  if (!getUserRequestAuth(req)) {
    return json({ error: "request_auth_required" }, { status: 401 });
  }
  const actor = await verifyActorLogin(req, actorLogin);
  if (actor instanceof NextResponse) return actor;
  return {
    tenantId: userTenantIdFor(actor.identity.githubId),
    actorId: `github:${actor.identity.githubId}`,
    kind: "user",
  };
}

async function legacyUserScope(
  req: NextRequest,
): Promise<GuidedFlowRequestScope | NextResponse> {
  const authError = await requireUserAuth(req);
  if (authError) return authError;
  if (!getUserRequestAuth(req)) {
    return json({ error: "request_auth_required" }, { status: 401 });
  }
  const actor = await verifyActorLogin(req, undefined);
  if (actor instanceof NextResponse) return actor;
  return {
    tenantId: userTenantIdFor(actor.identity.githubId),
    actorId: `github:${actor.identity.githubId}`,
    kind: "user",
  };
}

async function userScopeForInstance(
  req: NextRequest,
  instanceId: string,
): Promise<GuidedFlowRequestScope | null> {
  const scope = await userScope(req);
  if (scope instanceof NextResponse) return null;
  let instanceRow = (await getConvexClient().query(backendApi.guidedFlows.get, {
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    instanceId,
  })) as GuidedFlowRow | null;
  if (!instanceRow && getUserRequestAuth(req)) {
    const legacy = await legacyUserScope(req);
    if (
      !(legacy instanceof NextResponse) &&
      legacy.tenantId !== scope.tenantId
    ) {
      instanceRow = (await getConvexClient().query(backendApi.guidedFlows.get, {
        tenantId: legacy.tenantId,
        actorId: legacy.actorId,
        instanceId,
      })) as GuidedFlowRow | null;
      if (instanceRow) return { ...legacy, instanceRow };
    }
  }
  return instanceRow ? { ...scope, instanceRow } : null;
}

async function bootstrapScopeForInstance(
  req: NextRequest,
  instanceId: string,
): Promise<GuidedFlowRequestScope | null> {
  const bootstrap = readGuidedFlowBootstrapScope(req);
  if (!bootstrap) return null;
  const instanceRow = (await getConvexClient().query(
    backendApi.guidedFlows.get,
    {
      tenantId: bootstrap.tenantId,
      actorId: bootstrap.actorId,
      instanceId,
    },
  )) as GuidedFlowRow | null;
  return instanceRow
    ? {
        tenantId: bootstrap.tenantId,
        actorId: bootstrap.actorId,
        kind: "bootstrap",
        bootstrap,
        instanceRow,
      }
    : null;
}

function definitionForRow(
  row: GuidedFlowRow,
  customDefinitions: readonly StoredGuidedFlowDefinition[] = [],
): GuidedFlowDefinition {
  return guidedFlowDefinitionForInstance(row, customDefinitions);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const instanceId = url.searchParams.get("instanceId");
    const requestedStatus = url.searchParams.get("status");
    if (requestedStatus && requestedStatus !== "active") {
      return json({ error: "validation_error" }, { status: 400 });
    }
    const requestedConversationId = url.searchParams.get("conversationId");
    const conversationId = requestedConversationId
      ? conversationIdSchema.safeParse(requestedConversationId)
      : null;
    if (conversationId && !conversationId.success) {
      return json({ error: "validation_error" }, { status: 400 });
    }
    const userInstanceScope = instanceId
      ? await userScopeForInstance(req, instanceId)
      : null;
    const bootstrapScope = instanceId
      ? await bootstrapScopeForInstance(req, instanceId)
      : null;
    const existingBootstrap = readGuidedFlowBootstrapScope(req);
    const scope = userInstanceScope
      ? userInstanceScope
      : bootstrapScope
        ? bootstrapScope
        : getRequestAuth(req)
          ? await repositoryScope(req)
          : getUserRequestAuth(req) || getChatRequestContextProvider()
            ? await userScope(req)
            : existingBootstrap
              ? requestScopeForBootstrap(existingBootstrap)
              : null;
    if (!scope) {
      return json({ error: "repository_required" }, { status: 401 });
    }
    if (scope instanceof NextResponse) return scope;
    const tenantId = scope.tenantId;
    const actor = scope.actorId;
    const customDefinitions = await loadStoredGuidedFlowDefinitions(
      getConvexClient(),
      tenantId,
    );
    if (url.searchParams.get("view") === "templates") {
      return json({
        definitions: availableGuidedFlowDefinitions(customDefinitions),
      });
    }
    if (instanceId) {
      const row =
        scope.instanceRow ??
        ((await getConvexClient().query(backendApi.guidedFlows.get, {
          tenantId,
          actorId: actor,
          instanceId,
        })) as GuidedFlowRow | null);
      if (!row)
        return json({ error: "guided_flow_not_found" }, { status: 404 });
      const definition = definitionForRow(row, customDefinitions);
      return json({
        flow: presentGuidedFlow(
          definition,
          guidedFlowInstanceFromRow(row),
          await loadGuidedFlowRenderers(tenantId, [definition]),
        ),
      });
    }

    const rows =
      requestedStatus === "active"
        ? ((await getConvexClient().query(backendApi.guidedFlows.listActive, {
            tenantId,
            actorId: actor,
          })) as GuidedFlowRow[])
        : conversationId?.success
          ? await (async (): Promise<GuidedFlowRow[]> => {
              const binding = (await getConvexClient().query(
                backendApi.guidedFlows.getConversationBinding,
                {
                  tenantId,
                  actorId: actor,
                  conversationId: conversationId.data,
                },
              )) as { instanceId?: unknown } | null;
              if (typeof binding?.instanceId !== "string") return [];
              const row = (await getConvexClient().query(
                backendApi.guidedFlows.get,
                {
                  tenantId,
                  actorId: actor,
                  instanceId: binding.instanceId,
                },
              )) as GuidedFlowRow | null;
              return row ? [row] : [];
            })()
          : ((await getConvexClient().query(backendApi.guidedFlows.list, {
              tenantId,
              actorId: actor,
            })) as GuidedFlowRow[]);
    const listRenderers = await loadGuidedFlowRenderers(
      tenantId,
      rows.flatMap((row) => {
        try {
          return [definitionForRow(row, customDefinitions)];
        } catch {
          return [];
        }
      }),
    );
    const flows = rows.flatMap((row) => {
      try {
        const definition = definitionForRow(row, customDefinitions);
        return [
          presentGuidedFlow(
            definition,
            guidedFlowInstanceFromRow(row),
            listRenderers,
          ),
        ];
      } catch {
        return [];
      }
    });
    return json({
      flows,
      definitions: availableGuidedFlowDefinitions(customDefinitions),
    });
  } catch (error) {
    console.error("[GuidedFlows] list failed", error);
    return json({ error: "guided_flows_unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 100_000) {
    return json({ error: "request_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const action = (body as { action?: unknown } | null)?.action;
  const parsed =
    action === "start"
      ? startSchema.safeParse(body)
      : action === "bind"
        ? bindSchema.safeParse(body)
        : action === "create-definition"
          ? createDefinitionSchema.safeParse(body)
          : action === "update-definition"
            ? updateDefinitionSchema.safeParse(body)
            : action === "delete-definition"
              ? deleteDefinitionSchema.safeParse(body)
              : changeSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "validation_error", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const changesDefinition =
    parsed.data.action === "create-definition" ||
    parsed.data.action === "update-definition" ||
    parsed.data.action === "delete-definition";
  const client = getConvexClient();

  try {
    let scope: GuidedFlowRequestScope | NextResponse;
    if (changesDefinition) {
      if (getRequestAuth(req)) {
        const authError = await requireKodyAuth(req);
        if (authError) return authError;
        const auth = requireRepo(req);
        if (auth instanceof NextResponse) return auth;
        const verified = await verifyRepoWriteAccess(req);
        if (verified instanceof NextResponse) return verified;
        scope = {
          tenantId: tenantIdFor(auth.owner, auth.repo),
          actorId: verified.actorLogin,
          kind: "repository",
        };
      } else {
        scope = await userScope(req);
      }
    } else if (parsed.data.action === "start") {
      if (parsed.data.flowId === ONBOARDING_FLOW_ID) {
        scope = await userScope(req, parsed.data.actorLogin);
      } else if (getRequestAuth(req)) {
        scope = await repositoryScope(req, parsed.data.actorLogin);
      } else {
        scope = await userScope(req, parsed.data.actorLogin);
      }
    } else if ("instanceId" in parsed.data) {
      scope =
        (await userScopeForInstance(req, parsed.data.instanceId)) ??
        (await bootstrapScopeForInstance(req, parsed.data.instanceId)) ??
        (await repositoryScope(req));
    } else {
      return json({ error: "validation_error" }, { status: 400 });
    }
    if (scope instanceof NextResponse) return scope;
    const { tenantId, actorId: actor } = scope;

    if (
      parsed.data.action === "create-definition" ||
      parsed.data.action === "update-definition"
    ) {
      const input = parsed.data;
      const result = await saveGuidedFlowDefinition(client, {
        tenantId,
        mode: input.action === "update-definition" ? "update" : "create",
        ...(input.action === "update-definition"
          ? { flowId: input.flowId }
          : {}),
        draft: input.draft,
      });
      return result.ok
        ? json({ definition: result.definition }, { status: result.status })
        : json({ error: result.error }, { status: result.status });
    }

    if (parsed.data.action === "delete-definition") {
      const input = parsed.data as z.infer<typeof deleteDefinitionSchema>;
      const result = await archiveGuidedFlowDefinition(client, {
        tenantId,
        flowId: input.flowId,
      });
      return result.ok
        ? json({ deleted: input.flowId })
        : json({ error: result.error }, { status: result.status });
    }

    if (parsed.data.action === "start") {
      const start = parsed.data as z.infer<typeof startSchema>;
      const selected = await startOrResumeGuidedFlow(client, {
        tenantId,
        actorId: actor,
        flowId: start.flowId,
        instanceKey: start.instanceKey,
        conversationId: start.conversationId,
      });
      if (!selected)
        return json({ error: "unknown_guided_flow" }, { status: 404 });
      const response = json(
        presentGuidedFlow(
          selected.definition,
          selected.instance,
          await loadGuidedFlowRenderers(tenantId, [selected.definition]),
        ),
        { status: selected.created ? 201 : 200 },
      );
      if (scope.bootstrap) {
        setGuidedFlowBootstrapCookie(response, scope.bootstrap);
      }
      return response;
    }

    if (parsed.data.action === "bind") {
      const selected = await bindExistingGuidedFlow(client, {
        tenantId,
        actorId: actor,
        conversationId: parsed.data.conversationId,
        instanceId: parsed.data.instanceId,
      });
      if (!selected)
        return json({ error: "guided_flow_not_found" }, { status: 404 });
      return json(
        presentGuidedFlow(
          selected.definition,
          selected.instance,
          await loadGuidedFlowRenderers(tenantId, [selected.definition]),
        ),
      );
    }

    const instanceRow =
      scope.instanceRow ??
      ((await client.query(backendApi.guidedFlows.get, {
        tenantId,
        actorId: actor,
        instanceId: parsed.data.instanceId,
      })) as GuidedFlowRow | null);
    if (!instanceRow)
      return json({ error: "guided_flow_not_found" }, { status: 404 });
    const customDefinitions = await loadStoredGuidedFlowDefinitions(
      client,
      tenantId,
    );
    let definition = definitionForRow(instanceRow, customDefinitions);
    const current = guidedFlowInstanceFromRow(instanceRow);
    if (instanceRow.mutationId === parsed.data.mutationId) {
      const effectResult = await processGuidedFlowCompletionEffects(
        req,
        client,
        {
          tenantId,
          actorId: actor,
          instanceId: current.instanceId,
          instanceKey: current.instanceKey,
        },
      );
      return json({
        ...presentGuidedFlow(
          definition,
          current,
          await loadGuidedFlowRenderers(tenantId, [definition]),
        ),
        ...effectResult,
      });
    }
    if (current.revision !== parsed.data.expectedRevision) {
      return json({ error: "revision_conflict" }, { status: 409 });
    }
    if (
      parsed.data.action === "submit" &&
      parsed.data.stepId !== current.currentStepId
    ) {
      return json({ error: "step_conflict" }, { status: 409 });
    }
    const submittedFlow = {
      flowId: definition.id,
      flowVersion: definition.version,
      stepId: current.currentStepId,
    };
    let submittedResult = parsed.data.result;
    if (parsed.data.action === "sync-command") {
      const activeStep = getGuidedFlowStep(definition, current);
      if (!isCommandGuidedFlowStep(activeStep) || !activeStep.waitForCompletion) {
        return json({ error: "command_wait_not_enabled" }, { status: 409 });
      }
      const previousResult = guidedFlowStepResult(
        definition,
        current,
        activeStep.id,
      );
      if (previousResult?.status !== "running") {
        return json({ error: "command_not_running" }, { status: 409 });
      }
      submittedResult = await refreshGuidedFlowCommand(req, previousResult);
      if (submittedResult.status === "running") {
        return json(
          presentGuidedFlow(
            definition,
            current,
            await loadGuidedFlowRenderers(tenantId, [definition]),
          ),
        );
      }
    }
    if (parsed.data.action === "submit") {
      const activeStep = getGuidedFlowStep(definition, current);
      if (isCommandGuidedFlowStep(activeStep)) {
        if (
          parsed.data.actionId === "run" ||
          parsed.data.actionId === "approve"
        ) {
          submittedResult = await executeGuidedFlowCommand(
            req,
            activeStep.command,
            parsed.data.mutationId,
            {
              flowData: current.data,
              previousResult: guidedFlowStepResult(
                definition,
                current,
                activeStep.id,
              ),
              actionId: parsed.data.actionId,
            },
            activeStep.waitForCompletion === true,
          );
        } else if (parsed.data.actionId === "continue") {
          if (
            guidedFlowStepResult(definition, current, activeStep.id)?.status !==
            "completed"
          ) {
            return json({ error: "command_not_completed" }, { status: 409 });
          }
        }
      }
    }
    const runtimeActionId =
      parsed.data.action === "sync-command"
        ? "run"
        : parsed.data.action === "submit" &&
      isCommandGuidedFlowStep(getGuidedFlowStep(definition, current)) &&
      parsed.data.actionId === "approve"
        ? "run"
        : parsed.data.actionId;
    let runtime;
    if (parsed.data.action === "control") {
      if (!parsed.data.controlId) {
        return json({ error: "validation_error" }, { status: 400 });
      }
      runtime = {
        definition,
        instance: executeGuidedFlowControl({
          definition,
          instance: current,
          controlId: parsed.data.controlId,
        }),
        completed: [],
      };
    } else {
      runtime = runGuidedFlowAction({
        definition,
        instance: current,
        action:
          parsed.data.action === "sync-command" ? "submit" : parsed.data.action,
        actionId: runtimeActionId,
        result: submittedResult,
        resolveDefinition: (flowId, flowVersion) =>
          guidedFlowDefinitionForReference(
            flowId,
            flowVersion,
            customDefinitions,
          ),
      });
    }
    definition = runtime.definition;
    const next = runtime.instance;

    if (
      JSON.stringify({
        data: next.data,
        output: next.output,
        stack: next.stack,
      }).length > 20_000
    ) {
      return json({ error: "guided_flow_data_too_large" }, { status: 413 });
    }

    const completedAt = new Date().toISOString();
    await client.mutation(backendApi.guidedFlows.update, {
      tenantId,
      actorId: actor,
      expectedRevision: current.revision,
      ...guidedFlowInstanceWriteFields(next),
      updatedAt: new Date().toISOString(),
      mutationId: parsed.data.mutationId,
      ...(parsed.data.action === "submit" || parsed.data.action === "sync-command"
        ? {
            submission: {
              ...submittedFlow,
              actionId: parsed.data.actionId ?? "",
              result: sanitizeGuidedFlowData(submittedResult),
              submittedAt: new Date().toISOString(),
            },
          }
        : {}),
      ...(runtime.completed.length > 0
        ? {
            completions: runtime.completed.map((completed) => ({
              effectId: `${next.instanceId}:${completed.definition.id}@${completed.definition.version}:${completed.instance.revision}`,
              flowId: completed.definition.id,
              flowVersion: completed.definition.version,
              ...(completed.definition.onComplete
                ? { action: completed.definition.onComplete.action }
                : {}),
              completedAt,
              data: completed.instance.data,
            })),
          }
        : {}),
    });
    const effectResult = await processGuidedFlowCompletionEffects(req, client, {
      tenantId,
      actorId: actor,
      instanceId: next.instanceId,
      instanceKey: next.instanceKey,
    });
    return json({
      ...presentGuidedFlow(
        definition,
        next,
        await loadGuidedFlowRenderers(tenantId, [definition]),
      ),
      ...effectResult,
    });
  } catch (error) {
    if (error instanceof GuidedFlowControlError) {
      return json({ error: error.code }, { status: 409 });
    }
    if (error instanceof GuidedFlowCompletionError) {
      return json({ error: error.code }, { status: error.status });
    }
    if (error instanceof GuidedFlowCommandError) {
      return json({ error: error.code }, { status: error.status });
    }
    if (error instanceof GuidedFlowCompositionError) {
      return json({ error: error.code }, { status: 409 });
    }
    const message =
      error instanceof Error ? error.message : "GuidedFlow action failed";
    if (message.includes("guided_flow_already_exists")) {
      return json({ error: "guided_flow_already_exists" }, { status: 409 });
    }
    if (message.includes("guided_flow_not_found")) {
      return json({ error: "guided_flow_not_found" }, { status: 404 });
    }
    if (message.includes("not active") || message.includes("already at")) {
      return json({ error: "invalid_guided_flow_transition" }, { status: 409 });
    }
    console.error("[GuidedFlows] action failed", error);
    return json({ error: "guided_flow_action_failed" }, { status: 500 });
  }
}
