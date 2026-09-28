import { NextRequest, NextResponse } from "next/server";
import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { createLoopDefinition } from "@kody-ade/agency-domain";
import {
  deleteRepositoryLoop,
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

function isLegacyEventTrigger(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "event" || type === "webhook" || type === "condition";
}

function context(req: NextRequest, id: string) {
  const auth = getRequestAuth(req);
  if (!auth || !/^[a-z][a-z0-9-]{0,127}$/.test(id)) return null;
  return auth;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  const { id } = await params;
  const resolved = context(req, id);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_loop" }, { status: 400 });
  }
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_octokit" }, { status: 401 });
    }
    const body = await req.json();
    const loop = createLoopDefinition({ ...body, id });
    if (loop.target.kind === "workflow") {
      const target =
        (await readWorkflowDefinitionFile(
          loop.target.id,
          resolved.owner,
          resolved.repo,
        )) ??
        (await readCompanyStoreWorkflowDefinitionFile(loop.target.id, octokit));
      if (!target)
        throw new Error(
          `Loop target workflow "${loop.target.id}" was not found`,
        );
      const issues = validateWorkflowInput(
        loop.input,
        target.workflow.inputSchema,
      );
      if (issues.length > 0)
        throw new Error(issues.map((issue) => issue.message).join("; "));
    }
    const existing = await readRepositoryLoop(
      octokit,
      resolved.owner,
      resolved.repo,
      id,
    );
    if (
      isLegacyEventTrigger(loop.trigger) &&
      existing?.trigger.type !== loop.trigger.type
    ) {
      return NextResponse.json(
        {
          error: "event_triggers_use_workflow_rules",
          message:
            "GitHub and event-driven starts are configured as event rules, not Loops.",
        },
        { status: 400 },
      );
    }
    const updatedAt = "";
    await saveRepositoryLoop(
      octokit,
      resolved.owner,
      resolved.repo,
      loop,
      `chore(kody): update loop ${id}`,
    );
    await syncLoopWakeRegistration({
      owner: resolved.owner,
      repo: resolved.repo,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  const { id } = await params;
  const resolved = context(req, id);
  if (!resolved) {
    return NextResponse.json({ error: "invalid_loop" }, { status: 400 });
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });
  }
  await deleteRepositoryLoop(
    octokit,
    resolved.owner,
    resolved.repo,
    id,
    `chore(kody): remove loop ${id}`,
  );
  try {
    await syncLoopWakeRegistration({
      owner: resolved.owner,
      repo: resolved.repo,
      loopId: id,
    });
  } catch (error) {
    if (!(error instanceof LoopWakeSyncError)) throw error;
    return NextResponse.json(
      { error: "loop_schedule_sync_failed", message: error.message },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true });
}
