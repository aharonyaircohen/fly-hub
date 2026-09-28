import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { createUserOctokit } from "@kody-ade/base/github/core";
import { logger } from "@kody-ade/base/logger";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";
import { KODY_WORKFLOW_COMPLETION_SUMMARY_MAX_LENGTH } from "@kody-ade/base/events/catalog";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { dispatchWorkflowTriggers } from "@dashboard/features/workflows/server/github-workflow-trigger-dispatch";
import { deliverWorkflowInboxAlert } from "@dashboard/features/workflows/server/workflow-inbox-alert";
import { advancePipelineForWorkflowCompletion } from "@dashboard/features/pipelines/server/pipeline-orchestrator";
import { verifyQualityResult } from "@dashboard/features/quality/server/quality-result";
import { completeAgencyRequestsForWorkflow } from "@dashboard/features/agency/server/agency-request-completion";
import { qualityRunUsageSchema } from "@kody-ade/kody-chat-dashboard/quality/contracts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z
  .object({
    workflowId: z.string().trim().min(1).max(200),
    runId: z.string().trim().min(1).max(200),
    loopId: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["success", "failed", "blocked"]),
    summary: z
      .string()
      .trim()
      .min(1)
      .transform((value) =>
        value.slice(0, KODY_WORKFLOW_COMPLETION_SUMMARY_MAX_LENGTH),
      )
      .optional(),
    output: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

function qualityArtifactUrl(value: unknown, repository: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const expectedPrefix = `/${repository}/actions/runs/`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(expectedPrefix) ||
      !/^\d+$/.test(url.pathname.slice(expectedPrefix.length))
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "missing_workflow_identity" },
      { status: 401 },
    );
  }

  let identity: Awaited<ReturnType<typeof verifyGitHubWorkflowIdentity>>;
  try {
    identity = await verifyGitHubWorkflowIdentity(token);
  } catch {
    return NextResponse.json(
      { error: "invalid_workflow_identity" },
      { status: 401 },
    );
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const [owner, repo, ...extra] = identity.repository.split("/");
  if (!owner || !repo || extra.length > 0) {
    return NextResponse.json(
      { error: "invalid_repository_identity" },
      { status: 400 },
    );
  }
  const background = await resolveBackgroundToken(owner, repo);
  if (!background) {
    return NextResponse.json(
      { error: "background_token_unavailable" },
      { status: 503 },
    );
  }

  const { workflowId, runId, status, summary, output } = parsed.data;
  const deliveryId = `kody-workflow:${workflowId}:${runId}`;
  const event: SystemEventEnvelope = {
    id: deliveryId,
    name: "kody.workflow.completed",
    version: 2,
    occurredAt: new Date().toISOString(),
    userId: null,
    sessionId: null,
    brand: { owner, repo },
    source: "server",
    payload: {
      ...output,
      workflowId,
      runId,
      ...(parsed.data.loopId ? { loopId: parsed.data.loopId } : {}),
      status,
      ...(summary ? { summary } : {}),
      repository: identity.repository,
    },
  };

  setGitHubContext(owner, repo, background.token);
  let completionStage = "record_execution";
  try {
    const octokit = createUserOctokit(background.token);
    const backend = createBackendClient();
    const completedAt = new Date().toISOString();
    await backend.mutation(backendApi.mcpApprovalRequests.recordExecution, {
      tenantId: identity.repository,
      workflowId,
      runId,
      status,
      ...(summary ? { summary } : {}),
      ...(identity.runId ? { githubRunId: identity.runId } : {}),
      ...(identity.runId && /^\d+$/.test(identity.runId)
        ? {
            githubRunUrl: `https://github.com/${identity.repository}/actions/runs/${identity.runId}`,
          }
        : {}),
      completedAt,
    });
    completionStage = "quality_result";
    if (workflowId === "quality-run") {
      const [runRecord, map] = (await Promise.all([
        backend.query(backendApi.quality.getRun, {
          tenantId: identity.repository,
          runId,
        }),
        backend.query(backendApi.quality.getMap, {
          tenantId: identity.repository,
        }),
      ])) as [
        { run?: { journeySlugs?: string[] } } | null,
        {
          journeys?: Array<{
            slug: string;
            name: string;
            actionSlugs: string[];
          }>;
          actions?: Array<{ slug: string; name: string }>;
        } | null,
      ];
      const runJourneySlugs = runRecord?.run?.journeySlugs ?? [];
      const expectedJourneys = runJourneySlugs.map((slug) => {
        const journey = map?.journeys?.find(
          (candidate) => candidate.slug === slug,
        );
        if (!journey) return null;
        const actions = journey.actionSlugs.map((actionSlug) =>
          map?.actions?.find((action) => action.slug === actionSlug),
        );
        if (actions.some((action) => !action)) return null;
        return {
          slug: journey.slug,
          name: journey.name,
          actions: actions.filter(
            (action): action is { slug: string; name: string } =>
              Boolean(action),
          ),
        };
      });
      const completeExpectedJourneys = expectedJourneys?.filter(
        (
          journey,
        ): journey is {
          slug: string;
          name: string;
          actions: Array<{ slug: string; name: string }>;
        } => Boolean(journey),
      );
      const verification =
        completeExpectedJourneys.length > 0 &&
        completeExpectedJourneys.length === expectedJourneys.length
          ? verifyQualityResult(output, runId, completeExpectedJourneys)
          : {
              result: null,
              error: "Quality Run does not reference complete saved Journeys.",
            };
      const verifiedResult = verification.result;
      const qualitySummary = verifiedResult
        ? summary
        : status !== "success" && summary
          ? summary
          : verification.error;
      const artifactUrl =
        qualityArtifactUrl(output.artifactUrl, identity.repository) ??
        (identity.runId && /^\d+$/.test(identity.runId)
          ? `https://github.com/${identity.repository}/actions/runs/${identity.runId}`
          : null);
      const qualityStatus = verifiedResult?.status ?? "blocked";
      const usage = qualityRunUsageSchema.safeParse(output.usage);
      await backend.mutation(backendApi.quality.updateRun, {
        tenantId: identity.repository,
        runId,
        status: qualityStatus,
        updatedAt: completedAt,
        finishedAt: completedAt,
        ...(qualityStatus === "passed"
          ? {}
          : {
              error: qualitySummary ?? `Quality Run ${qualityStatus}.`,
            }),
      });
      await backend.mutation(backendApi.quality.appendRunEvent, {
        tenantId: identity.repository,
        runId,
        time: completedAt,
        idempotencyKey: `workflow-completed:${deliveryId}`,
        event: {
          type: "quality_run_completed",
          status: qualityStatus,
          ...(qualitySummary ? { summary: qualitySummary } : {}),
          ...(typeof output.journeyName === "string"
            ? { journeyName: output.journeyName }
            : {}),
          ...(typeof output.artifactPath === "string"
            ? { artifactPath: output.artifactPath }
            : {}),
          ...(artifactUrl ? { artifactUrl } : {}),
          ...(usage.success ? { usage: usage.data } : {}),
          ...(verifiedResult
            ? {
                passed: verifiedResult.passed,
                failed: verifiedResult.failed,
                blocked: verifiedResult.blocked,
                journeyResults: verifiedResult.journeyResults,
                actionResults: verifiedResult.actionResults,
                scenarioResult: verifiedResult.scenarioResult,
              }
            : {}),
        },
      });
    }
    completionStage = "pipeline";
    await advancePipelineForWorkflowCompletion({
      octokit,
      owner,
      repo,
      workflowRunId: runId,
      status,
      output,
    });
    completionStage = "agency_requests";
    await completeAgencyRequestsForWorkflow({
      octokit,
      owner,
      repo,
      workflowId,
      runId,
      ...(parsed.data.loopId ? { loopId: parsed.data.loopId } : {}),
      status,
      ...(summary ? { summary } : {}),
      output,
    });
    completionStage = "workflow_triggers";
    await dispatchWorkflowTriggers({
      event,
      deliveryId,
      octokit,
    });
    if (status === "blocked") {
      try {
        await deliverWorkflowInboxAlert({
          owner,
          repo,
          workflowId,
          runId,
          summary: summary ?? "The workflow is blocked and needs attention.",
          url: new URL(
            `/repo/${owner}/${repo}/workflows/${workflowId}`,
            request.url,
          ).toString(),
          octokit,
        });
      } catch (error) {
        logger.warn(
          {
            event: "workflow_inbox_alert_failed",
            workflowId,
            runId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Workflow completed, but its Inbox alert could not be delivered",
        );
      }
    }
  } catch (error) {
    logger.error(
      {
        event: "workflow_completion_stage_failed",
        workflowId,
        runId,
        completionStage,
        error: error instanceof Error ? error.message : String(error),
      },
      "Workflow completion stage failed",
    );
    throw new Error(`Workflow completion failed during ${completionStage}`, {
      cause: error,
    });
  } finally {
    clearGitHubContext();
  }

  return new NextResponse(null, { status: 204 });
}
