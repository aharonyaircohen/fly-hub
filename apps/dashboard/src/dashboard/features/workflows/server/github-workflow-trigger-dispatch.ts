import "server-only";
import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";
import { logger } from "@kody-ade/base/logger";
import { getTriggers } from "@kody-ade/base/triggers/config";
import {
  resolveActionData,
  triggerMatches,
} from "@kody-ade/base/triggers/engine";
import { consumeStoredAgencyApproval } from "@kody-ade/agency/agency-approvals";
import { createCompanyWorkflowLoader } from "./company-workflow-loader";
import { createGitHubActionsEngineGateway } from "./github-actions-engine-gateway";
import { startWorkflow } from "./start-workflow";
import {
  validateWorkflowInput,
  validateWorkflowDefinition,
} from "@dashboard/lib/workflow-definitions";
import { workflowRequiresApproval } from "./workflow-execution-authorization";
import { workflowRunAction } from "@kody-ade/agency/workflow-run-approval";
import { createCompanyPipelineLoader } from "@dashboard/features/pipelines/server/company-pipeline-loader";
import { pipelineRequiresApproval } from "@dashboard/features/pipelines/server/pipeline-execution-authorization";
import { startPipelineExecution } from "@dashboard/features/pipelines/server/pipeline-orchestrator";
import { validatePipelineDefinition } from "@dashboard/lib/pipeline-definitions";

const MAX_INPUT_BYTES = 64_000;

function requestIdFor(sourceEventId: string, triggerId: string): string {
  const digest = createHash("sha256")
    .update(`${sourceEventId}:${triggerId}`)
    .digest("hex")
    .slice(0, 40);
  return `github-${digest}`;
}

function sourceEventIdFor(event: SystemEventEnvelope): string {
  const payload = event.payload as { runId?: unknown; runAttempt?: unknown };
  if (typeof payload.runId !== "number" && typeof payload.runId !== "string") {
    return event.id;
  }
  const runId = `${event.name}:${payload.runId}`;
  return event.name === "github.workflow_run.completed" &&
    typeof payload.runAttempt === "number"
    ? `${runId}:attempt:${payload.runAttempt}`
    : runId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sourceRunNeverStarted(input: {
  event: SystemEventEnvelope;
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<boolean> {
  const payload = input.event.payload as {
    runId?: unknown;
    conclusion?: unknown;
  };
  if (
    (payload.conclusion !== "failure" && payload.conclusion !== "cancelled") ||
    typeof payload.runId !== "number"
  ) {
    return false;
  }

  try {
    const response = await input.octokit.rest.actions.listJobsForWorkflowRun({
      owner: input.owner,
      repo: input.repo,
      run_id: payload.runId,
      filter: "latest",
    });
    const jobs = response.data.jobs;
    return (
      jobs.length > 0 &&
      jobs.every(
        (job) =>
          job.conclusion === "cancelled" &&
          !job.runner_name &&
          (!job.steps || job.steps.length === 0),
      )
    );
  } catch (error) {
    logger.warn(
      {
        owner: input.owner,
        repo: input.repo,
        runId: payload.runId,
        error: errorMessage(error),
      },
      "failed to inspect source workflow jobs; continuing trigger evaluation",
    );
    return false;
  }
}

async function updateDelivery(
  operation: "markDispatched" | "markFailed",
  input: {
    owner: string;
    repo: string;
    deliveryId: string;
    sourceEventId: string;
    triggerId: string;
    error?: string;
  },
): Promise<void> {
  const client = createBackendClient();
  if (operation === "markDispatched") {
    await client.mutation(api.workflowEventDeliveries.markDispatched, {
      tenantId: `${input.owner}/${input.repo}`,
      deliveryId: input.deliveryId,
      sourceEventId: input.sourceEventId,
      triggerId: input.triggerId,
      now: new Date().toISOString(),
    });
    return;
  }
  await client.mutation(api.workflowEventDeliveries.markFailed, {
    tenantId: `${input.owner}/${input.repo}`,
    deliveryId: input.deliveryId,
    sourceEventId: input.sourceEventId,
    triggerId: input.triggerId,
    error: input.error ?? "workflow trigger failed",
    now: new Date().toISOString(),
  });
}

/**
 * Start configured Workflows for one normalized GitHub event. Delivery claims
 * are durable and keyed by source event + trigger, so webhook redeliveries do
 * not start the same configured Workflow twice.
 */
export async function dispatchWorkflowTriggers(input: {
  event: SystemEventEnvelope;
  deliveryId: string;
  octokit: Octokit;
}): Promise<void> {
  const brand = input.event.brand;
  if (!brand) return;

  const sourceEventId = sourceEventIdFor(input.event);

  const triggers = await getTriggers(input.octokit, brand.owner, brand.repo, {
    cache: false,
  });
  const workflowPath = input.event.payload.workflowPath;
  if (workflowPath === ".github/workflows/kody.yml") {
    logger.info(
      { owner: brand.owner, repo: brand.repo, delivery: input.deliveryId },
      "github workflow trigger skipped for Kody Engine workflow to prevent recursion",
    );
    return;
  }
  const matchingTriggers = triggers.filter(
    (trigger) =>
      (trigger.action.type === "start-workflow" ||
        trigger.action.type === "start-pipeline") &&
      triggerMatches(trigger, input.event),
  );
  if (matchingTriggers.length === 0) return;
  if (
    await sourceRunNeverStarted({
      event: input.event,
      octokit: input.octokit,
      owner: brand.owner,
      repo: brand.repo,
    })
  ) {
    logger.info(
      {
        owner: brand.owner,
        repo: brand.repo,
        runId: input.event.payload.runId,
        delivery: input.deliveryId,
      },
      "github workflow trigger skipped because the source run never acquired a runner",
    );
    return;
  }
  for (const trigger of matchingTriggers) {
    if (trigger.action.type !== "start-pipeline") continue;
    const action = trigger.action;
    const pipelineInput = resolveActionData(trigger, input.event);
    if (JSON.stringify(pipelineInput).length > MAX_INPUT_BYTES) {
      logger.warn(
        { trigger: trigger.id, pipeline: trigger.action.pipelineId },
        "Pipeline trigger skipped: input too large",
      );
      continue;
    }
    const pipelineRunId = requestIdFor(sourceEventId, trigger.id).replace(
      /^github-/,
      "run-trigger-",
    );
    try {
      const loaded = await createCompanyPipelineLoader({
        octokit: input.octokit,
        owner: brand.owner,
        repo: brand.repo,
      })(trigger.action.pipelineId);
      if (!loaded) throw new Error("Pipeline not found");
      const issues = [
        ...validatePipelineDefinition(loaded.pipeline),
        ...validateWorkflowInput(pipelineInput, loaded.pipeline.inputSchema),
      ];
      if (issues.length) {
        throw new Error(issues.map((issue) => issue.message).join("; "));
      }
      if (await pipelineRequiresApproval(action.pipelineId, loaded.pipeline)) {
        throw new Error("Pipeline requires approval");
      }
      const rawConcurrencyKey = action.concurrencyKey
        ? pipelineInput[action.concurrencyKey]
        : undefined;
      if (
        action.concurrencyKey &&
        (rawConcurrencyKey === undefined ||
          rawConcurrencyKey === null ||
          (typeof rawConcurrencyKey !== "string" &&
            typeof rawConcurrencyKey !== "number" &&
            typeof rawConcurrencyKey !== "boolean"))
      ) {
        throw new Error(
          `Pipeline concurrency input ${action.concurrencyKey} is missing or invalid`,
        );
      }
      await startPipelineExecution({
        octokit: input.octokit,
        owner: brand.owner,
        repo: brand.repo,
        pipelineId: trigger.action.pipelineId,
        pipelineRunId,
        concurrencyKey:
          rawConcurrencyKey === undefined
            ? undefined
            : String(rawConcurrencyKey),
        pipeline: loaded.pipeline,
        facts: pipelineInput,
      });
    } catch (error) {
      logger.warn(
        {
          trigger: trigger.id,
          pipeline: trigger.action.pipelineId,
          error: errorMessage(error),
        },
        "Pipeline trigger failed; continuing with remaining triggers",
      );
    }
  }
  for (const trigger of matchingTriggers) {
    if (trigger.action.type !== "start-workflow") continue;
    const action = trigger.action;
    const requestId = requestIdFor(sourceEventId, trigger.id);
    const workflowInput = resolveActionData(trigger, input.event);

    let claim: { claimed: boolean; status: string };
    try {
      claim = await createBackendClient().mutation(
        api.workflowEventDeliveries.reserve,
        {
          tenantId: `${brand.owner}/${brand.repo}`,
          deliveryId: input.deliveryId,
          sourceEventId,
          triggerId: trigger.id,
          workflowId: action.workflowId,
          eventName: input.event.name,
          requestId,
          sourceUrl:
            typeof input.event.payload.htmlUrl === "string"
              ? input.event.payload.htmlUrl
              : undefined,
          input: workflowInput,
          now: new Date().toISOString(),
        },
      );
    } catch (error) {
      logger.warn(
        { trigger: trigger.id, error: errorMessage(error) },
        "github workflow trigger claim failed; continuing with remaining triggers",
      );
      continue;
    }
    if (!claim.claimed) continue;

    if (JSON.stringify(workflowInput).length > MAX_INPUT_BYTES) {
      try {
        await updateDelivery("markFailed", {
          owner: brand.owner,
          repo: brand.repo,
          deliveryId: input.deliveryId,
          sourceEventId,
          triggerId: trigger.id,
          error: "workflow input exceeds 64KB",
        });
      } catch (error) {
        logger.warn(
          { trigger: trigger.id, error: errorMessage(error) },
          "oversized workflow input failure could not be recorded",
        );
      }
      logger.warn(
        { trigger: trigger.id, workflow: action.workflowId },
        "github workflow trigger skipped: input too large",
      );
      continue;
    }

    const actor = `github-webhook:${brand.owner}/${brand.repo}`;
    try {
      const result = await startWorkflow(
        {
          workflowId: action.workflowId,
          source: "github",
          actor,
          requestId,
          input: workflowInput,
        },
        {
          createRequestId: () => requestId,
          now: () => new Date().toISOString(),
          loadWorkflow: createCompanyWorkflowLoader({
            octokit: input.octokit,
            owner: brand.owner,
            repo: brand.repo,
            syncStoreDefinitions: true,
          }),
          validateDefinition: validateWorkflowDefinition,
          validateInput: (schema, value) =>
            validateWorkflowInput(value, schema),
          requiresApproval: workflowRequiresApproval,
          actionFor: workflowRunAction,
          consumeApproval: (approval) =>
            consumeStoredAgencyApproval({
              owner: brand.owner,
              repo: brand.repo,
              approvalId: approval.approvalId,
              scopeKind: "workflow",
              scopeId: approval.workflowId,
              action: approval.action,
              approvedBy: approval.actor,
              dispatchKey: approval.dispatchKey,
              consumedAt: approval.consumedAt,
            }),
          dispatch: createGitHubActionsEngineGateway({
            octokit: input.octokit,
            owner: brand.owner,
            repo: brand.repo,
          }),
        },
      );

      if (result.kind !== "accepted") {
        const reason =
          result.kind === "invalid"
            ? result.issues.map((issue) => issue.message).join("; ")
            : result.kind;
        await updateDelivery("markFailed", {
          owner: brand.owner,
          repo: brand.repo,
          deliveryId: input.deliveryId,
          sourceEventId,
          triggerId: trigger.id,
          error: reason,
        });
        logger.warn(
          {
            trigger: trigger.id,
            workflow: action.workflowId,
            result: result.kind,
          },
          "github workflow trigger did not dispatch",
        );
        continue;
      }
      await updateDelivery("markDispatched", {
        owner: brand.owner,
        repo: brand.repo,
        deliveryId: input.deliveryId,
        sourceEventId,
        triggerId: trigger.id,
      });
    } catch (error) {
      try {
        await updateDelivery("markFailed", {
          owner: brand.owner,
          repo: brand.repo,
          deliveryId: input.deliveryId,
          sourceEventId,
          triggerId: trigger.id,
          error: errorMessage(error),
        });
      } catch (markFailedError) {
        logger.warn(
          { trigger: trigger.id, error: errorMessage(markFailedError) },
          "github workflow trigger failure could not be recorded",
        );
      }
      logger.warn(
        {
          trigger: trigger.id,
          workflow: action.workflowId,
          error: errorMessage(error),
        },
        "github workflow trigger failed; continuing with remaining triggers",
      );
    }
  }
}

/** Compatibility name for the GitHub webhook caller. */
export const dispatchGitHubWorkflowTriggers = dispatchWorkflowTriggers;
