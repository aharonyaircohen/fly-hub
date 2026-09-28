import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  buildPipelineDefinition,
  pipelineStepDefinitionSchema,
  slugifyPipelineDefinitionId,
  validatePipelineDefinition,
} from "@dashboard/lib/pipeline-definitions";
import {
  listCompanyStorePipelineDefinitionFiles,
  listPipelineDefinitionFiles,
  readPipelineDefinitionFile,
  writePipelineDefinitionFile,
} from "@dashboard/lib/pipeline-definition-files";
import { listWorkflowDefinitionFiles } from "@dashboard/lib/workflow-definition-files";
import { reconcileProjectedStorePipelines } from "@dashboard/lib/backend/repo-projection";
import { pipelineAutomationEligibility } from "@dashboard/features/pipelines/server/pipeline-execution-authorization";

const payloadSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(pipelineStepDefinitionSchema).min(1).max(50),
  runWithoutApproval: z.boolean().optional(),
  actorLogin: z.string().trim().optional(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit)
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const [local, { config }] = await Promise.all([
      listPipelineDefinitionFiles(auth.owner, auth.repo),
      getEngineConfig(octokit, auth.owner, auth.repo),
    ]);
    const active = new Set(config.company?.activePipelines ?? []);
    const localIds = new Set(local.map((pipeline) => pipeline.id));
    const store = active.size
      ? (await listCompanyStorePipelineDefinitionFiles(octokit)).filter(
          (pipeline) => active.has(pipeline.id) && !localIds.has(pipeline.id),
        )
      : [];
    await reconcileProjectedStorePipelines(auth.owner, auth.repo, store).catch(
      () => undefined,
    );
    const pipelines = [...local, ...store].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const automationById = await pipelineAutomationEligibility(pipelines);
    return NextResponse.json(
      {
        pipelines: pipelines.map((pipeline) => ({
          ...pipeline,
          automation: automationById.get(pipeline.id) ?? {
            eligible: false as const,
            reason: "approval-required" as const,
          },
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  setGitHubContext(
    auth.owner,
    auth.repo,
    auth.token,
    auth.storeRepoUrl,
    auth.storeRef,
  );
  try {
    const parsed = payloadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    const actor = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actor instanceof NextResponse) return actor;
    const octokit = await getUserOctokit(req);
    if (!octokit)
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    const id = slugifyPipelineDefinitionId(parsed.data.id ?? parsed.data.name);
    if (!id)
      return NextResponse.json(
        { error: "invalid_pipeline_id" },
        { status: 400 },
      );
    if (await readPipelineDefinitionFile(id, auth.owner, auth.repo)) {
      return NextResponse.json({ error: "pipeline_exists" }, { status: 409 });
    }
    const pipeline = buildPipelineDefinition(parsed.data);
    const [localWorkflows, { config }] = await Promise.all([
      listWorkflowDefinitionFiles(auth.owner, auth.repo),
      getEngineConfig(octokit, auth.owner, auth.repo),
    ]);
    const issues = validatePipelineDefinition(pipeline, {
      knownWorkflows: new Set([
        ...localWorkflows.map((workflow) => workflow.id),
        ...(config.company?.activeWorkflows ?? []),
      ]),
    });
    if (issues.length)
      return NextResponse.json(
        { error: "invalid_pipeline", issues },
        { status: 400 },
      );
    await writePipelineDefinitionFile({
      owner: auth.owner,
      repo: auth.repo,
      id,
      pipeline,
    });
    return NextResponse.json({
      pipeline: {
        id,
        path: `pipelines/${id}/pipeline.json`,
        pipeline,
        source: "local",
        readOnly: false,
        runnable: true,
      },
    });
  } finally {
    clearGitHubContext();
  }
}
