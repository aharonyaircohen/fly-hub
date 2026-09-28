import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { POST as activateStoreCatalogAsset } from "../../store-catalog/import/route";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { GET as getQualityResource } from "@kody-ade/kody-chat-dashboard/routes/kody/quality";
import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoWriteAccess,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { workflowRunAction } from "@kody-ade/agency/workflow-run-approval";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { readDashboardConfig } from "@dashboard/lib/dashboard-config/store";
import { resolveEnvironments } from "@kody-ade/fly/preview-environments";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startWorkflow } from "@dashboard/features/workflows/server/start-workflow";
import { workflowRequiresApproval } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import {
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "@dashboard/lib/workflow-definitions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  return getQualityResource(req, {
    params: Promise.resolve({ resource: "runs" }),
  });
}

const inputSchema = z.object({
  scenarioSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  retryOfRunId: z.string().max(128).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

type QualityMap = {
  actions: Array<{
    slug: string;
    name: string;
    outcome: string;
    area: string;
    status: "draft" | "active" | "archived";
    updatedAt: string;
  }>;
  journeys: Array<{
    slug: string;
    name: string;
    goal: string;
    priority: "critical" | "high" | "normal";
    status: "draft" | "active" | "archived";
    actionSlugs: string[];
    updatedAt: string;
  }>;
  scenarios: Array<{
    slug: string;
    journeySlug?: string;
    journeySlugs?: string[];
    name: string;
    kind:
      | "happy"
      | "validation"
      | "permission"
      | "failure"
      | "recovery"
      | "persistence";
    given: string;
    expectedVisible: string;
    expectedState: string;
    cleanup?: string;
    status: "draft" | "active" | "archived";
    environmentId?: string;
    updatedAt: string;
  }>;
};

function orderedJourneySlugs(
  scenario: QualityMap["scenarios"][number],
): string[] {
  return scenario.journeySlugs?.length
    ? scenario.journeySlugs
    : scenario.journeySlug
      ? [scenario.journeySlug]
      : [];
}

function executableJourney(
  map: QualityMap,
  journey: QualityMap["journeys"][number],
) {
  if (
    journey.status !== "active" ||
    !Array.isArray(journey.actionSlugs) ||
    journey.actionSlugs.length === 0
  ) {
    return null;
  }
  const actions = journey.actionSlugs.map((slug) =>
    map.actions.find((candidate) => candidate.slug === slug),
  );
  if (actions.some((action) => !action || action.status !== "active")) {
    return null;
  }
  return {
    slug: journey.slug,
    name: journey.name,
    goal: journey.goal,
    priority: journey.priority,
    actions: actions.map((action) => ({
      slug: action!.slug,
      name: action!.name,
      outcome: action!.outcome,
      area: action!.area,
    })),
  };
}

function latestDefinitionUpdate(
  scenario: QualityMap["scenarios"][number],
  journeys: QualityMap["journeys"],
  actions: QualityMap["actions"],
): string {
  return [
    scenario.updatedAt,
    ...journeys.map((journey) => journey.updatedAt),
    ...journeys.flatMap((journey) =>
      journey.actionSlugs.flatMap((slug) => {
        const action = actions.find((candidate) => candidate.slug === slug);
        return action ? [action.updatedAt] : [];
      }),
    ),
  ].reduce((latest, candidate) => (candidate > latest ? candidate : latest));
}

function safeRemoteTarget(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1"
    ) {
      return null;
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function ensureQualityWorkflow(req: NextRequest): Promise<void> {
  const headers = new Headers(req.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  const response = await activateStoreCatalogAsset(
    new NextRequest(
      new URL("/api/kody/store-catalog/import", req.nextUrl.origin),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "workflow", slug: "quality-run" }),
      },
    ),
  );
  if (!response.ok) {
    throw new Error(
      `Quality Run workflow activation failed (${response.status})`,
    );
  }
}

export async function POST(req: NextRequest) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json(
      { error: "missing_repo_context" },
      { status: 400 },
    );

  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "validation_error" }, { status: 400 });

  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );
  const client = createBackendClient();
  const tenantId = `${auth.owner}/${auth.repo}`;
  const now = new Date().toISOString();
  const runId = `run-${randomUUID()}`;
  const runSlug = `${parsed.data.scenarioSlug}-${runId.slice(4, 12)}`;
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit)
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const map = (await client.query(backendApi.quality.getMap, {
      tenantId,
    })) as QualityMap;
    const scenario = map.scenarios.find(
      (candidate) => candidate.slug === parsed.data.scenarioSlug,
    );
    const journeySlugs = scenario ? orderedJourneySlugs(scenario) : [];
    const journeys = scenario
      ? journeySlugs.map((slug) =>
          map.journeys.find((candidate) => candidate.slug === slug),
        )
      : [];
    if (
      !scenario ||
      journeys.length === 0 ||
      journeys.some((journey) => !journey)
    )
      return NextResponse.json(
        { error: "scenario_not_found" },
        { status: 404 },
      );
    const savedJourneys = journeys.filter(
      (journey): journey is QualityMap["journeys"][number] => Boolean(journey),
    );
    const resolvedJourneys = savedJourneys.map((journey) =>
      executableJourney(map, journey),
    );
    if (
      scenario.status !== "active" ||
      !scenario.environmentId ||
      resolvedJourneys.some((journey) => !journey)
    ) {
      return NextResponse.json(
        { error: "scenario_not_executable" },
        { status: 409 },
      );
    }

    await ensureQualityWorkflow(req);

    const repository = await octokit.rest.repos.get({
      owner: auth.owner,
      repo: auth.repo,
    });
    const branch = repository.data.default_branch || "main";
    const commit = await octokit.rest.repos.getCommit({
      owner: auth.owner,
      repo: auth.repo,
      ref: branch,
    });
    const sourceCommit = commit.data.sha;
    const { doc: dashboardConfig } = await readDashboardConfig(
      auth.owner,
      auth.repo,
    );
    const targetEnvironment = resolveEnvironments(dashboardConfig).find(
      (candidate) => candidate.id === scenario.environmentId,
    );
    const targetUrl = targetEnvironment?.url
      ? safeRemoteTarget(targetEnvironment.url)
      : null;
    if (!targetEnvironment || !targetUrl) {
      return NextResponse.json(
        { error: "quality_environment_unavailable" },
        { status: 409 },
      );
    }
    const environment = targetEnvironment.label;

    await client.mutation(backendApi.quality.createRun, {
      tenantId,
      runId,
      runSlug,
      journeySlugs: savedJourneys.map((journey) => journey.slug),
      scenarioSlug: scenario.slug,
      environment,
      targetUrl,
      sourceCommit,
      definitionUpdatedAt: latestDefinitionUpdate(
        scenario,
        savedJourneys,
        map.actions,
      ),
      createdAt: now,
      ...(parsed.data.retryOfRunId
        ? { retryOfRunId: parsed.data.retryOfRunId }
        : {}),
    });

    const result = await startWorkflow(
      {
        workflowId: "quality-run",
        source: "dashboard",
        actor: `github:${actorResult.identity.githubId}`,
        requestId: runId,
        input: {
          qualityRunId: runId,
          journeys: resolvedJourneys,
          scenario: {
            slug: scenario.slug,
            name: scenario.name,
            kind: scenario.kind,
            given: scenario.given,
            expectedVisible: scenario.expectedVisible,
            expectedState: scenario.expectedState,
            ...(scenario.cleanup ? { cleanup: scenario.cleanup } : {}),
          },
          targetUrl,
          sourceCommit,
        },
      },
      {
        createRequestId: () => runId,
        now: () => new Date().toISOString(),
        loadWorkflow: createCompanyWorkflowLoader({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
          syncStoreDefinitions: true,
        }),
        validateDefinition: validateWorkflowDefinition,
        validateInput: (schema, input) => validateWorkflowInput(input, schema),
        requiresApproval: workflowRequiresApproval,
        actionFor: workflowRunAction,
        consumeApproval: async () => false,
        dispatch: createGitHubActionsEngineGateway({
          octokit,
          owner: auth.owner,
          repo: auth.repo,
          dashboardUrl: req.nextUrl.origin,
          storeRepoUrl: auth.storeRepoUrl,
          storeRef: auth.storeRef,
          model: parsed.data.model,
        }),
      },
    );

    if (result.kind !== "accepted") {
      const updatedAt = new Date().toISOString();
      await client.mutation(backendApi.quality.updateRun, {
        tenantId,
        runId,
        status: "blocked",
        updatedAt,
        finishedAt: updatedAt,
        error: `Quality workflow ${result.kind}`,
      });
      return NextResponse.json(
        { error: "quality_workflow_unavailable", runId },
        { status: 409 },
      );
    }

    await client.mutation(backendApi.quality.appendRunEvent, {
      tenantId,
      runId,
      idempotencyKey: "dashboard:dispatch-accepted",
      event: { type: "dispatch_accepted", requestId: result.requestId },
      time: result.acceptedAt,
    });
    await client.mutation(backendApi.quality.updateRun, {
      tenantId,
      runId,
      status: "running",
      updatedAt: result.acceptedAt,
      startedAt: result.acceptedAt,
    });
    recordAudit(req, {
      action: "quality.run",
      resource: scenario.slug,
      detail: `Quality Run ${runId}`,
    });
    return NextResponse.json(
      { runId, runSlug, status: "running", acceptedAt: result.acceptedAt },
      { status: 202 },
    );
  } catch (error) {
    const updatedAt = new Date().toISOString();
    await client
      .mutation(backendApi.quality.updateRun, {
        tenantId,
        runId,
        status: "blocked",
        updatedAt,
        finishedAt: updatedAt,
        error: "Quality Run dispatch failed",
      })
      .catch(() => undefined);
    console.error("[quality-runs] dispatch failed", { runId, error });
    return NextResponse.json(
      { error: "quality_run_dispatch_failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
