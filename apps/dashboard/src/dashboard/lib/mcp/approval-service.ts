import { Octokit } from "@octokit/rest";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  consumeStoredAgencyApproval,
  grantStoredAgencyApproval,
} from "@kody-ade/agency/agency-approvals";
import {
  verifyWorkflowApprovalChallenge,
  workflowRunAction,
} from "@kody-ade/agency/workflow-run-approval";
import { readResolvedCapabilityFile } from "@kody-ade/agency/capabilities";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startWorkflow } from "@dashboard/features/workflows/server/start-workflow";
import { approveWorkflowRun } from "@dashboard/features/workflows/server/approve-workflow-run";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";
import {
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "@dashboard/lib/workflow-definitions";
import { unresolvedWorkflowCapabilityIssues } from "@dashboard/lib/capabilities/resolve-workflow";
import { resolveInstalledCapabilitySlugs } from "@dashboard/lib/company-store/installed-capabilities";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";
import { buildKodyWorkflowDispatchInputs } from "@dashboard/lib/kody-workflow-dispatch";
import {
  deleteRepositoryLoop,
  saveRepositoryLoop,
} from "@dashboard/lib/repository-loops";
import { syncLoopWakeRegistration } from "@dashboard/features/agency/server/loop-wake-registration";
import { mutateTriggers, triggerConfigSchema } from "@kody-ade/base/triggers";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";
import { mutateNotificationsManifest } from "@dashboard/lib/notifications-server";
import {
  type NotificationChannel,
  type NotificationRule,
  NotificationCreateRuleInputSchema,
  slugifyRuleName,
  uniqueRuleId,
} from "@dashboard/lib/notifications";

export type ClaimedMcpApproval = {
  tenantId: string;
  requestId: string;
  workRecordId: string;
  targetKind: "workflow" | "capability" | "automation";
  workflowId: string;
  runId: string;
  mode: "start" | "resume";
  input: Record<string, unknown>;
  action: string;
  approvalId: string;
  approvalToken: string;
  actor: {
    tokenId: string;
    name: string;
    actorLogin: string;
    actorGithubId: number;
  };
  status: "approving" | "rejected";
};

export type ApprovalDecisionDependencies = {
  claimDecision(input: {
    tenantId: string;
    requestId: string;
    decision: "approved" | "rejected";
    decidedBy: string;
    decidedAt: string;
  }): Promise<ClaimedMcpApproval | null>;
  dispatchWorkflow(
    request: ClaimedMcpApproval,
  ): Promise<Record<string, unknown>>;
  dispatchCapability(
    request: ClaimedMcpApproval,
  ): Promise<Record<string, unknown>>;
  dispatchAutomation(
    request: ClaimedMcpApproval,
  ): Promise<Record<string, unknown>>;
  finish(input: {
    tenantId: string;
    requestId: string;
    status: "dispatched" | "failed";
    result: Record<string, unknown>;
    updatedAt: string;
  }): Promise<unknown>;
};

export async function decideMcpApprovalRequest(
  input: {
    tenantId: string;
    requestId: string;
    decision: "approved" | "rejected";
    decidedBy: string;
  },
  dependencies: ApprovalDecisionDependencies,
) {
  const decidedAt = new Date().toISOString();
  const request = await dependencies.claimDecision({ ...input, decidedAt });
  if (!request) throw new Error("Approval request is unavailable");
  if (request.status === "rejected")
    return { requestId: request.requestId, status: "rejected" as const };
  try {
    const result =
      request.targetKind === "workflow"
        ? await dependencies.dispatchWorkflow(request)
        : request.targetKind === "capability"
          ? await dependencies.dispatchCapability(request)
          : await dependencies.dispatchAutomation(request);
    await dependencies.finish({
      tenantId: input.tenantId,
      requestId: input.requestId,
      status: "dispatched",
      result,
      updatedAt: new Date().toISOString(),
    });
    return {
      requestId: request.requestId,
      status: "dispatched" as const,
      ...result,
    };
  } catch (error) {
    await dependencies.finish({
      tenantId: input.tenantId,
      requestId: input.requestId,
      status: "failed",
      result: { error: "dispatch_failed" },
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function splitTenant(tenantId: string) {
  const [owner = "", repo = ""] = tenantId.split("/", 2);
  if (!owner || !repo) throw new Error("Invalid repository scope");
  return { owner, repo };
}

async function repositoryContext(request: ClaimedMcpApproval) {
  const { owner, repo } = splitTenant(request.tenantId);
  const background = await resolveBackgroundToken(owner, repo);
  if (!background) throw new Error("Repository access is not configured");
  const octokit = new Octokit({ auth: background.token });
  return { owner, repo, octokit, token: background.token };
}

export function createApprovalDecisionDependencies({
  origin,
}: {
  origin: string;
}): ApprovalDecisionDependencies {
  const backend = createBackendClient();
  return {
    async claimDecision(input) {
      return (await backend.mutation(
        backendApi.mcpApprovalRequests.claimDecision,
        input,
      )) as ClaimedMcpApproval | null;
    },
    async finish(input) {
      return await backend.mutation(
        backendApi.mcpApprovalRequests.finish,
        input,
      );
    },
    async dispatchWorkflow(request) {
      const { owner, repo, octokit, token } = await repositoryContext(request);
      const actor = `github:${request.actor.actorGithubId}`;
      setGitHubContext(owner, repo, token);
      try {
        const loader = createCompanyWorkflowLoader({ octokit, owner, repo });
        const approved = await approveWorkflowRun(
          { workflowId: request.workflowId, input: request.input },
          {
            verifyChallenge: () =>
              verifyWorkflowApprovalChallenge({
                owner,
                repo,
                actor,
                workflowId: request.workflowId,
                input: request.input,
                signingKey: getWorkflowApprovalSigningKey(),
                token: request.approvalToken,
              }),
            loadWorkflow: loader,
            validateWorkflow: (workflow, input) => [
              ...validateWorkflowDefinition(workflow),
              ...validateWorkflowInput(input, workflow.inputSchema),
            ],
            grantApproval: (approval) =>
              grantStoredAgencyApproval({
                owner,
                repo,
                approvalId: approval.approvalId,
                scopeKind: "workflow",
                scopeId: request.workflowId,
                action: approval.action,
                approvedBy: actor,
                approvedAt: new Date().toISOString(),
                expiresAt: approval.expiresAt,
              }),
          },
        );
        if (approved.kind !== "approved")
          throw new Error(`Workflow approval failed: ${approved.kind}`);

        const result = await startWorkflow(
          {
            workflowId: request.workflowId,
            source: "dashboard",
            actor,
            requestId: request.runId,
            resume: request.mode === "resume",
            approvalId: approved.approvalId,
            ...(request.mode === "start" ? { input: request.input } : {}),
          },
          {
            createRequestId: () => request.runId,
            now: () => new Date().toISOString(),
            loadWorkflow: loader,
            validateDefinition: validateWorkflowDefinition,
            validateResolvedCapabilities: async (workflow) => {
              const { config } = await getEngineConfig(octokit, owner, repo);
              return await unresolvedWorkflowCapabilityIssues(workflow, {
                octokit,
                tenantId: request.tenantId,
                activeStoreSlugs: new Set(
                  config.company?.activeCapabilities ?? [],
                ),
                builtInSlugs: ENGINE_BUILT_IN_CAPABILITIES,
              });
            },
            validateInput: (schema, input) =>
              validateWorkflowInput(input, schema),
            requiresApproval: async () => true,
            actionFor: () => workflowRunAction(request.input),
            consumeApproval: async (approval) => {
              const consumed = await consumeStoredAgencyApproval({
                owner,
                repo,
                approvalId: approval.approvalId,
                scopeKind: "workflow",
                scopeId: request.workflowId,
                action: approval.action,
                approvedBy: actor,
                dispatchKey: approval.dispatchKey,
                consumedAt: approval.consumedAt,
              });
              if (consumed && request.mode === "resume") {
                await backend.mutation(backendApi.workflowRuns.approveStep, {
                  tenantId: request.tenantId,
                  workflowId: request.workflowId,
                  runId: request.runId,
                  stepId: String(request.input.stepId),
                  contextHash: String(request.input.contextHash),
                  approvedAt: new Date().toISOString(),
                  approvedBy: actor,
                });
              }
              return consumed;
            },
            dispatch: createGitHubActionsEngineGateway({
              octokit,
              owner,
              repo,
              dashboardUrl: origin,
            }),
          },
        );
        if (result.kind !== "accepted")
          throw new Error(`Workflow dispatch failed: ${result.kind}`);
        return {
          runId: result.requestId,
          workflowId: request.workflowId,
          execution: "kody-engine",
          acceptedAt: result.acceptedAt,
        };
      } finally {
        clearGitHubContext();
      }
    },
    async dispatchCapability(request) {
      const { owner, repo, octokit, token } = await repositoryContext(request);
      setGitHubContext(owner, repo, token);
      try {
        const { config } = await getEngineConfig(octokit, owner, repo);
        const activeStoreSlugs = await resolveInstalledCapabilitySlugs(
          octokit,
          config,
        );
        const capability = await readResolvedCapabilityFile(
          request.workflowId,
          octokit,
          { activeStoreSlugs, tenantId: request.tenantId },
        );
        if (!capability) throw new Error("Capability was not found");
        await grantStoredAgencyApproval({
          owner,
          repo,
          approvalId: request.approvalId,
          scopeKind: "capability",
          scopeId: request.workflowId,
          action: request.action,
          approvedBy: request.actor.actorLogin,
          approvedAt: new Date().toISOString(),
        });
        const consumed = await consumeStoredAgencyApproval({
          owner,
          repo,
          approvalId: request.approvalId,
          scopeKind: "capability",
          scopeId: request.workflowId,
          action: request.action,
          approvedBy: request.actor.actorLogin,
          dispatchKey: request.runId,
          consumedAt: new Date().toISOString(),
        });
        if (!consumed) throw new Error("Capability approval was not consumed");
        const repository = await octokit.rest.repos.get({ owner, repo });
        const ref = repository.data.default_branch || "main";
        const inputs = await buildKodyWorkflowDispatchInputs(octokit, {
          owner,
          repo,
          ref,
          action: request.workflowId,
          requestId: request.runId,
        });
        await octokit.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: "kody.yml",
          ref,
          inputs,
        });
        const acceptedAt = new Date().toISOString();
        return {
          runId: request.runId,
          capabilityId: request.workflowId,
          execution: "kody-engine",
          acceptedAt,
        };
      } finally {
        clearGitHubContext();
      }
    },
    async dispatchAutomation(request) {
      const { owner, repo, octokit, token } = await repositoryContext(request);
      setGitHubContext(owner, repo, token);
      try {
        if (request.action === "schedule.save") {
          const loop = request.input.schedule;
          const saved = await saveRepositoryLoop(
            octokit,
            owner,
            repo,
            loop,
            `chore(kody): save schedule ${request.workflowId}`,
          );
          await syncLoopWakeRegistration({ owner, repo, loop: saved.loop });
          return {
            automationId: saved.loop.id,
            automationKind: "schedule",
            operation: saved.created ? "created" : "updated",
            execution: "kody-online",
          };
        }
        if (request.action === "schedule.delete") {
          const deleted = await deleteRepositoryLoop(
            octokit,
            owner,
            repo,
            request.workflowId,
            `chore(kody): remove schedule ${request.workflowId}`,
          );
          if (!deleted) throw new Error("Schedule was not found");
          await syncLoopWakeRegistration({
            owner,
            repo,
            loopId: request.workflowId,
          });
          return {
            automationId: request.workflowId,
            automationKind: "schedule",
            operation: "deleted",
            execution: "kody-online",
          };
        }
        if (request.action === "trigger.save") {
          const trigger = triggerConfigSchema.parse(request.input.trigger);
          await mutateTriggers(octokit, owner, repo, (existing) => [
            ...existing.filter((item) => item.id !== trigger.id),
            trigger,
          ]);
          return {
            automationId: trigger.id,
            automationKind: "event-trigger",
            operation: "saved",
            execution: "kody-online",
          };
        }
        if (request.action === "trigger.delete") {
          let found = false;
          await mutateTriggers(octokit, owner, repo, (existing) => {
            const next = existing.filter(
              (item) => item.id !== request.workflowId,
            );
            found = next.length !== existing.length;
            return next;
          });
          if (!found) throw new Error("Trigger was not found");
          return {
            automationId: request.workflowId,
            automationKind: "event-trigger",
            operation: "deleted",
            execution: "kody-online",
          };
        }
        if (request.action === "webhook.reconcile") {
          const result = await ensureWebhook({
            token,
            owner,
            repo,
            hookUrl: `${origin}/api/webhooks/github`,
          });
          if (!result.ok) throw new Error("Webhook reconciliation failed");
          return {
            automationId: "github-webhook",
            automationKind: "webhook",
            operation: result.created ? "created" : "updated",
            execution: "kody-online",
          };
        }
        if (request.action === "notification.rule.create") {
          const input = NotificationCreateRuleInputSchema.parse(
            request.input.rule,
          );
          const outcome = await mutateNotificationsManifest<NotificationRule>(
            (manifest) => {
              const id = uniqueRuleId(
                slugifyRuleName(input.name),
                manifest.rules,
              );
              const rule: NotificationRule = {
                id,
                name: input.name,
                enabled: input.enabled,
                event: input.event,
                channel: input.channel as NotificationChannel,
                template: input.template,
                createdAt: new Date().toISOString(),
              };
              return {
                next: { ...manifest, rules: [...manifest.rules, rule] },
                result: rule,
              };
            },
          );
          if ("kind" in outcome)
            throw new Error("Notification rule creation failed");
          return {
            automationId: outcome.result.id,
            automationKind: "notification-rule",
            operation: "created",
            execution: "kody-online",
          };
        }
        if (request.action === "notification.rule.delete") {
          let found = false;
          await mutateNotificationsManifest((manifest) => {
            const rules = manifest.rules.filter(
              (rule) => rule.id !== request.workflowId,
            );
            found = rules.length !== manifest.rules.length;
            return {
              next: { ...manifest, rules },
              result: found,
            };
          });
          if (!found) throw new Error("Notification rule was not found");
          return {
            automationId: request.workflowId,
            automationKind: "notification-rule",
            operation: "deleted",
            execution: "kody-online",
          };
        }
        throw new Error("Unsupported automation approval action");
      } finally {
        clearGitHubContext();
      }
    },
  };
}
