import "server-only";
import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { logger } from "@kody-ade/base/logger";
import {
  type PipelineDefinition,
  type PipelineStepDefinition,
} from "@dashboard/lib/pipeline-definitions";
import {
  validateWorkflowDefinition,
  validateWorkflowInput,
  workflowInputFromFacts,
} from "@dashboard/lib/workflow-definitions";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startWorkflow } from "@dashboard/features/workflows/server/start-workflow";
import { deliverPipelineApprovalRequest } from "@dashboard/features/workflows/server/workflow-inbox-alert";

function childRunId(pipelineRunId: string, stepId: string): string {
  const digest = createHash("sha256")
    .update(`${pipelineRunId}:${stepId}`)
    .digest("hex")
    .slice(0, 40);
  return `run-pipeline-${digest}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PipelineContinuation = {
  kind: "next" | "start";
  pipelineId: string;
  runId: string;
  stepIndex: number;
  step: { id: string; workflowId: string };
  facts: Record<string, unknown>;
};

function isPipelineContinuation(value: unknown): value is PipelineContinuation {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "next" || kind === "start";
}

export async function startPipelineExecution(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pipelineId: string;
  pipelineRunId: string;
  concurrencyKey?: string;
  pipeline: PipelineDefinition;
  facts: Record<string, unknown>;
}): Promise<{ claimed: boolean; acceptedAt: string }> {
  const acceptedAt = new Date().toISOString();
  const reservation = await createBackendClient().mutation(
    api.pipelineRuns.reserve,
    {
      tenantId: `${input.owner}/${input.repo}`,
      pipelineId: input.pipelineId,
      runId: input.pipelineRunId,
      concurrencyKey: input.concurrencyKey,
      facts: input.facts,
      steps: input.pipeline.steps.map((step) => ({
        id: step.id,
        workflowId: step.workflow,
        ...(step.decisionFact ? { decisionFact: step.decisionFact } : {}),
        status: "pending" as const,
      })),
      now: acceptedAt,
    },
  );
  if (!reservation.claimed) {
    return {
      claimed: false,
      acceptedAt: reservation.run?.updatedAt ?? acceptedAt,
    };
  }
  try {
    await dispatchPipelineStep({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      pipelineId: input.pipelineId,
      pipelineRunId: input.pipelineRunId,
      stepIndex: 0,
      step: input.pipeline.steps[0]!,
      facts: input.facts,
    });
  } catch (error) {
    await failPipelineDispatch({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      pipelineId: input.pipelineId,
      pipelineRunId: input.pipelineRunId,
      error,
    });
    throw error;
  }
  return { claimed: true, acceptedAt };
}

export async function dispatchPipelineStep(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pipelineId: string;
  pipelineRunId: string;
  stepIndex: number;
  step: PipelineStepDefinition;
  facts: Record<string, unknown>;
}): Promise<{ workflowRunId: string }> {
  const workflowRunId = childRunId(input.pipelineRunId, input.step.id);
  const loadWorkflow = createCompanyWorkflowLoader({
    octokit: input.octokit,
    owner: input.owner,
    repo: input.repo,
    syncStoreDefinitions: true,
  });
  const loaded = await loadWorkflow(input.step.workflow);
  if (!loaded) {
    throw new Error(`Pipeline Workflow ${input.step.workflow} was not found.`);
  }
  const workflowInput = workflowInputFromFacts(
    input.facts,
    loaded.workflow.inputSchema,
  );
  const result = await startWorkflow(
    {
      workflowId: input.step.workflow,
      source: "dashboard",
      actor: `pipeline:${input.pipelineId}`,
      requestId: workflowRunId,
      input: workflowInput,
    },
    {
      createRequestId: () => workflowRunId,
      now: () => new Date().toISOString(),
      loadWorkflow: async (workflowId) =>
        workflowId === input.step.workflow
          ? loaded
          : await loadWorkflow(workflowId),
      validateDefinition: validateWorkflowDefinition,
      validateInput: (schema, value) => validateWorkflowInput(value, schema),
      // The Pipeline approval is the authority for its declared child runs.
      requiresApproval: async () => false,
      consumeApproval: async () => true,
      actionFor: () => `pipeline:${input.pipelineId}`,
      dispatch: createGitHubActionsEngineGateway({
        octokit: input.octokit,
        owner: input.owner,
        repo: input.repo,
      }),
    },
  );
  if (result.kind !== "accepted") {
    const detail =
      result.kind === "invalid"
        ? result.issues.map((issue) => issue.message).join("; ")
        : result.kind;
    throw new Error(
      `Pipeline Workflow ${input.step.workflow} was not started: ${detail}`,
    );
  }
  await createBackendClient().mutation(api.pipelineRuns.markDispatched, {
    tenantId: `${input.owner}/${input.repo}`,
    pipelineId: input.pipelineId,
    runId: input.pipelineRunId,
    stepIndex: input.stepIndex,
    workflowRunId,
    now: new Date().toISOString(),
  });
  return { workflowRunId };
}

export async function failPipelineDispatch(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pipelineId: string;
  pipelineRunId: string;
  error: unknown;
}): Promise<void> {
  const next = await createBackendClient().mutation(
    api.pipelineRuns.failDispatch,
    {
      tenantId: `${input.owner}/${input.repo}`,
      pipelineId: input.pipelineId,
      runId: input.pipelineRunId,
      error: message(input.error),
      now: new Date().toISOString(),
    },
  );
  if (isPipelineContinuation(next)) {
    await dispatchPipelineContinuation({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      next,
    });
  }
}

async function dispatchPipelineContinuation(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  next: PipelineContinuation;
}): Promise<void> {
  const step: PipelineStepDefinition = {
    id: input.next.step.id,
    workflow: input.next.step.workflowId,
  };
  try {
    await dispatchPipelineStep({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      pipelineId: input.next.pipelineId,
      pipelineRunId: input.next.runId,
      stepIndex: input.next.stepIndex,
      step,
      facts: input.next.facts,
    });
  } catch (error) {
    await failPipelineDispatch({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      pipelineId: input.next.pipelineId,
      pipelineRunId: input.next.runId,
      error,
    });
    logger.error(
      {
        pipeline: input.next.pipelineId,
        runId: input.next.runId,
        error: message(error),
      },
      "Pipeline failed to start its next Workflow",
    );
  }
}

export async function advancePipelineForWorkflowCompletion(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  workflowRunId: string;
  status: "success" | "failed" | "blocked";
  output: Record<string, unknown>;
}): Promise<boolean> {
  const next = await createBackendClient().mutation(api.pipelineRuns.advance, {
    tenantId: `${input.owner}/${input.repo}`,
    workflowRunId: input.workflowRunId,
    status: input.status,
    output: input.output,
    now: new Date().toISOString(),
  });
  if (!next) return false;
  if (
    typeof next === "object" &&
    next !== null &&
    (next as { kind?: unknown }).kind === "approval"
  ) {
    const approval = next as {
      pipelineId: string;
      runId: string;
      facts: Record<string, unknown>;
    };
    const issue =
      typeof approval.facts.issue === "number" &&
      Number.isInteger(approval.facts.issue) &&
      approval.facts.issue > 0
        ? approval.facts.issue
        : undefined;
    await deliverPipelineApprovalRequest({
      owner: input.owner,
      repo: input.repo,
      pipelineId: approval.pipelineId,
      runId: approval.runId,
      ...(issue ? { issue } : {}),
      summary: issue
        ? `Kody recommends continuing Pipeline ${approval.pipelineId} for issue #${issue}.`
        : `Kody recommends continuing Pipeline ${approval.pipelineId}.`,
      url: issue
        ? `https://github.com/${input.owner}/${input.repo}/issues/${issue}`
        : `https://github.com/${input.owner}/${input.repo}`,
      octokit: input.octokit,
    });
    return true;
  }
  if (isPipelineContinuation(next)) {
    await dispatchPipelineContinuation({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      next,
    });
  }
  return true;
}

export async function decidePipelineExecution(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pipelineId: string;
  runId: string;
  decision: "approve" | "reject";
  decidedBy: string;
}): Promise<{ kind: "approved" | "rejected" | "unavailable" }> {
  const next = await createBackendClient().mutation(api.pipelineRuns.decide, {
    tenantId: `${input.owner}/${input.repo}`,
    pipelineId: input.pipelineId,
    runId: input.runId,
    decision: input.decision,
    decidedBy: input.decidedBy,
    now: new Date().toISOString(),
  });
  if (!next) return { kind: "unavailable" };
  if (next.kind === "rejected") {
    if (isPipelineContinuation(next.next)) {
      await dispatchPipelineContinuation({
        octokit: input.octokit,
        owner: input.owner,
        repo: input.repo,
        next: next.next,
      });
    }
    return { kind: "rejected" };
  }
  if (isPipelineContinuation(next)) {
    await dispatchPipelineContinuation({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      next,
    });
    return { kind: "approved" };
  }
  return { kind: "unavailable" };
}
