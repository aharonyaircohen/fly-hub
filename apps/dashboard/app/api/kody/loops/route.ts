import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { createLoopDefinition } from "@kody-ade/agency-domain";
import {
  listRepositoryLoops,
  readRepositoryLoop,
  saveRepositoryLoop,
} from "@dashboard/lib/repository-loops";
import {
  syncLoopWakeRegistration,
  LoopWakeSyncError,
} from "@dashboard/features/agency/server/loop-wake-registration";
import {
  readCompanyStoreWorkflowDefinitionFile,
  readWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";
import { validateWorkflowInput } from "@dashboard/lib/workflow-definitions";

async function validateLoopInput(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
  loop: ReturnType<typeof createLoopDefinition>,
) {
  if (loop.target.kind !== "workflow") return;
  const target =
    (await readWorkflowDefinitionFile(loop.target.id, owner, repo)) ??
    (await readCompanyStoreWorkflowDefinitionFile(loop.target.id, octokit));
  if (!target)
    throw new Error(`Loop target workflow "${loop.target.id}" was not found`);
  const issues = validateWorkflowInput(loop.input, target.workflow.inputSchema);
  if (issues.length > 0)
    throw new Error(issues.map((issue) => issue.message).join("; "));
}

const trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("schedule"),
    every: z.string().trim().min(1),
    at: z
      .object({
        time: z.string().trim().min(1),
        timezone: z.string().trim().min(1),
      })
      .optional(),
  }),
  z.object({ type: z.literal("event"), event: z.string().trim().min(1) }),
  z.object({ type: z.literal("webhook"), event: z.string().trim().min(1) }),
  z.object({
    type: z.literal("condition"),
    expression: z.string().trim().min(1),
  }),
]);
const payload = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/),
  trigger,
  target: z.object({
    kind: z.enum(["workflow", "capability", "pipeline", "agent"]),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/),
  }),
  input: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

function isLegacyEventTrigger(
  value: z.infer<typeof trigger>,
): value is
  | { type: "event"; event: string }
  | { type: "webhook"; event: string }
  | { type: "condition"; expression: string } {
  return (
    value.type === "event" ||
    value.type === "webhook" ||
    value.type === "condition"
  );
}

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "repository_context_required" },
      { status: 400 },
    );
  }
  const repositoryLoops = await listRepositoryLoops(
    octokit,
    auth.owner,
    auth.repo,
  );
  const loops = repositoryLoops.map((loop) => ({ ...loop, updatedAt: "" }));
  return NextResponse.json({ loops });
}

export async function POST(req: NextRequest) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  const octokit = await getUserOctokit(req);
  if (!auth || !octokit) {
    return NextResponse.json(
      { error: "repository_context_required" },
      { status: 400 },
    );
  }
  try {
    const loop = createLoopDefinition(payload.parse(await req.json()));
    await validateLoopInput(octokit, auth.owner, auth.repo, loop);
    if (isLegacyEventTrigger(loop.trigger)) {
      return NextResponse.json(
        {
          error: "event_triggers_use_workflow_rules",
          message:
            "GitHub and event-driven starts are configured as event rules, not Loops.",
        },
        { status: 400 },
      );
    }
    const existing = await readRepositoryLoop(
      octokit,
      auth.owner,
      auth.repo,
      loop.id,
    );
    if (existing) {
      if (!isDeepStrictEqual(existing, loop)) {
        return NextResponse.json({ error: "loop_exists" }, { status: 409 });
      }
      await syncLoopWakeRegistration({
        owner: auth.owner,
        repo: auth.repo,
        loop,
      });
      return NextResponse.json({ loop: { ...loop, updatedAt: "" } });
    }
    const updatedAt = "";
    await saveRepositoryLoop(
      octokit,
      auth.owner,
      auth.repo,
      loop,
      `chore(kody): add loop ${loop.id}`,
    );
    await syncLoopWakeRegistration({
      owner: auth.owner,
      repo: auth.repo,
      loop,
    });
    return NextResponse.json({ loop: { ...loop, updatedAt } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof LoopWakeSyncError
            ? "loop_schedule_sync_failed"
            : "invalid_loop",
        message: error instanceof Error ? error.message : "Invalid Loop",
      },
      { status: error instanceof LoopWakeSyncError ? 503 : 400 },
    );
  }
}
