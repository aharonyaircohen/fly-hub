import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@kody-ade/base/auth";
import { clearGitHubContext, setGitHubContext } from "@dashboard/lib/github-client";
import { createLiveAgentDependencies } from "@dashboard/features/agency/server/live-agent-dependencies";
import {
  activateLiveAgent,
  deactivateLiveAgent,
  liveAgentLoopId,
  readLiveAgentStatus,
  setLiveAgentPaused,
} from "@dashboard/features/agency/server/live-agent-lifecycle";
import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";
import { startLoop } from "@dashboard/features/workflows/server/start-loop";
import { authorizeLoopExecution } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import { LIVE_SCHEDULE_VALUES } from "@dashboard/lib/schedule-options";

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const activateSchema = z.object({
  action: z.literal("activate"),
  intent: slugSchema,
  every: z.enum(LIVE_SCHEDULE_VALUES),
});
const actionSchema = z.discriminatedUnion("action", [
  activateSchema,
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("reset") }),
]);

async function context(req: NextRequest, slug: string) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit || !slugSchema.safeParse(slug).success) {
    return NextResponse.json({ error: "invalid_live_agent" }, { status: 400 });
  }
  setGitHubContext(auth.owner, auth.repo, auth.token, auth.storeRepoUrl, auth.storeRef);
  return {
    auth,
    octokit,
    deps: createLiveAgentDependencies({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
    }),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await context(req, slug);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ status: await readLiveAgentStatus(slug, ctx.deps) });
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await context(req, slug);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const action = actionSchema.parse(await req.json());
    if (action.action === "activate") {
      return NextResponse.json({
        status: await activateLiveAgent({ agent: slug, intent: action.intent, every: action.every }, ctx.deps),
      });
    }
    if (action.action === "pause" || action.action === "resume") {
      await setLiveAgentPaused(slug, action.action === "pause", ctx.deps);
    } else if (action.action === "reset") {
      await ctx.deps.resetState(slug);
      await ctx.deps.saveState({
        version: 1,
        agent: slug,
        revision: 0,
        cursor: "",
        summary: "",
        data: {},
        updatedAt: ctx.deps.now(),
      });
    } else {
      const result = await startLoop(
        { loopId: liveAgentLoopId(slug), source: "dashboard", approved: true },
        {
          createRequestId: () => `run-${randomUUID()}`,
          loadLoop: ctx.deps.readLoop,
          authorize: authorizeLoopExecution,
          dispatch: createGitHubActionsEngineGateway({
            octokit: ctx.octokit,
            owner: ctx.auth.owner,
            repo: ctx.auth.repo,
          }),
        },
      );
      if (result.kind !== "accepted") {
        return NextResponse.json({ error: result.kind }, { status: 409 });
      }
      return NextResponse.json({ runId: result.requestId, acceptedAt: result.acceptedAt }, { status: 202 });
    }
    return NextResponse.json({ status: await readLiveAgentStatus(slug, ctx.deps) });
  } catch (error) {
    return NextResponse.json(
      { error: "live_agent_failed", message: error instanceof Error ? error.message : "Live Agent operation failed" },
      { status: error instanceof z.ZodError ? 400 : 409 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await context(req, slug);
  if (ctx instanceof NextResponse) return ctx;
  try {
    await deactivateLiveAgent(slug, ctx.deps);
    return NextResponse.json({ ok: true });
  } finally {
    clearGitHubContext();
  }
}
