import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { getEngineConfig, writeConfigPatch } from "@kody-ade/base/engine/config";
import { clearGitHubContext, setGitHubContext } from "@dashboard/lib/github-client";
import {
  isPipelineDefinitionId,
  mergePipelineDefinition,
  pipelineStepDefinitionSchema,
  validatePipelineDefinition,
} from "@dashboard/lib/pipeline-definitions";
import {
  deletePipelineDefinitionFile,
  readCompanyStorePipelineDefinitionFile,
  readPipelineDefinitionFile,
  writePipelineDefinitionFile,
} from "@dashboard/lib/pipeline-definition-files";
import { listWorkflowDefinitionFiles } from "@dashboard/lib/workflow-definition-files";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(pipelineStepDefinitionSchema).min(1).max(50).optional(),
  runWithoutApproval: z.boolean().optional(),
  actorLogin: z.string().trim().optional(),
});

async function context(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth) return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  setGitHubContext(auth.owner, auth.repo, auth.token, auth.storeRepoUrl, auth.storeRef);
  const octokit = await getUserOctokit(req);
  if (!octokit) return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  return { auth, octokit };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!isPipelineDefinitionId(id)) return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
    const local = await readPipelineDefinitionFile(id, ctx.auth.owner, ctx.auth.repo);
    if (local) return NextResponse.json({ pipeline: { id, path: local.path, pipeline: local.pipeline, source: "local", readOnly: false, runnable: true } });
    const { config } = await getEngineConfig(ctx.octokit, ctx.auth.owner, ctx.auth.repo);
    if ((config.company?.activePipelines ?? []).includes(id)) {
      const store = await readCompanyStorePipelineDefinitionFile(id, ctx.octokit);
      if (store) return NextResponse.json({ pipeline: store });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!isPipelineDefinitionId(id)) return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
    const actor = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actor instanceof NextResponse) return actor;
    const existing = await readPipelineDefinitionFile(id, ctx.auth.owner, ctx.auth.repo);
    if (!existing) {
      if (await readCompanyStorePipelineDefinitionFile(id, ctx.octokit)) {
        return NextResponse.json({ error: "store_pipeline_protected", message: "Store Pipelines cannot be edited from this repo." }, { status: 409 });
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const pipeline = mergePipelineDefinition(existing.pipeline, parsed.data);
    const [localWorkflows, { config }] = await Promise.all([
      listWorkflowDefinitionFiles(ctx.auth.owner, ctx.auth.repo),
      getEngineConfig(ctx.octokit, ctx.auth.owner, ctx.auth.repo),
    ]);
    const issues = validatePipelineDefinition(pipeline, {
      knownWorkflows: new Set([
        ...localWorkflows.map((workflow) => workflow.id),
        ...(config.company?.activeWorkflows ?? []),
      ]),
    });
    if (issues.length) return NextResponse.json({ error: "invalid_pipeline", issues }, { status: 400 });
    await writePipelineDefinitionFile({ owner: ctx.auth.owner, repo: ctx.auth.repo, id, pipeline });
    return NextResponse.json({ pipeline: { id, path: existing.path, pipeline, source: "local", readOnly: false, runnable: true } });
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!isPipelineDefinitionId(id)) return NextResponse.json({ error: "invalid_pipeline_id" }, { status: 400 });
    const actor = await verifyActorLogin(req, undefined);
    if (actor instanceof NextResponse) return actor;
    const existing = await readPipelineDefinitionFile(id, ctx.auth.owner, ctx.auth.repo);
    if (existing) {
      await deletePipelineDefinitionFile({ owner: ctx.auth.owner, repo: ctx.auth.repo, id });
      return NextResponse.json({ success: true });
    }
    const { config } = await getEngineConfig(ctx.octokit, ctx.auth.owner, ctx.auth.repo, { force: true });
    const active = config.company?.activePipelines ?? [];
    if (!active.includes(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const next = active.filter((slug) => slug !== id);
    await writeConfigPatch(ctx.octokit, ctx.auth.owner, ctx.auth.repo, {
      activePipelines: next.length ? next : null,
    }, `chore(pipelines): remove store Pipeline ${id}`);
    return NextResponse.json({ success: true, removedStoreReference: true });
  } finally {
    clearGitHubContext();
  }
}
