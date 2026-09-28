import type { NextRequest } from "next/server";
import { guidedFlowInternalJsonHeaders } from "./internal-request-headers";

export class GuidedFlowCommandError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export interface GuidedFlowCommandContext {
  readonly flowData?: Readonly<Record<string, unknown>>;
  readonly previousResult?: Readonly<Record<string, unknown>>;
  readonly actionId?: string;
}

export async function executeGuidedFlowCommand(
  req: NextRequest,
  command: string,
  mutationId: string,
  context?: GuidedFlowCommandContext,
  waitForCompletion = false,
): Promise<Readonly<Record<string, unknown>>> {
  const headers = guidedFlowInternalJsonHeaders(req, mutationId);
  const response = await fetch(new URL("/api/kody/chat/operations", req.url), {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: command,
      ...(context ? { context } : {}),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new GuidedFlowCommandError(
      typeof payload.error === "string" ? payload.error : "command_failed",
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  if (
    payload.handled !== true ||
    !payload.result ||
    typeof payload.result !== "object" ||
    Array.isArray(payload.result)
  ) {
    throw new GuidedFlowCommandError("command_not_executable", 400);
  }
  const result = payload.result as Readonly<Record<string, unknown>>;
  const dispatchedWorkflow =
    waitForCompletion &&
    typeof result.workflowId === "string" &&
    typeof result.runId === "string";
  return {
    status:
      result.status === "needs_attention"
        ? "needs_attention"
        : dispatchedWorkflow
          ? "running"
          : "completed",
    summary:
      typeof result.summary === "string"
        ? result.summary
        : "Command completed.",
    ...(typeof result.approvalChallenge === "string"
      ? { approvalChallenge: result.approvalChallenge }
      : {}),
    ...(typeof result.approvalExpiresAt === "string"
      ? { approvalExpiresAt: result.approvalExpiresAt }
      : {}),
    ...(typeof result.runId === "string" ? { runId: result.runId } : {}),
    ...(typeof result.workflowId === "string"
      ? { workflowId: result.workflowId }
      : {}),
    ...(result.workflowInput &&
    typeof result.workflowInput === "object" &&
    !Array.isArray(result.workflowInput)
      ? { workflowInput: result.workflowInput }
      : {}),
  };
}

export async function refreshGuidedFlowCommand(
  req: NextRequest,
  result: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const workflowId = typeof result.workflowId === "string" ? result.workflowId : "";
  const runId = typeof result.runId === "string" ? result.runId : "";
  if (!workflowId || !runId) {
    throw new GuidedFlowCommandError("workflow_run_reference_missing", 409);
  }
  const response = await fetch(
    new URL(
      `/api/kody/company/workflows/${encodeURIComponent(workflowId)}/runs?runId=${encodeURIComponent(runId)}`,
      req.url,
    ),
    {
      cache: "no-store",
      headers: guidedFlowInternalJsonHeaders(req, `status:${runId}`),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new GuidedFlowCommandError("workflow_status_unavailable", 502);
  }
  const run = payload.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) return result;
  const state = (run as Record<string, unknown>).state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return result;
  const status = (state as Record<string, unknown>).status;
  if (status === "done") {
    return { ...result, status: "completed", summary: "Workflow completed." };
  }
  if (status === "failed" || status === "blocked") {
    const blocker = (state as Record<string, unknown>).blocker;
    return {
      ...result,
      status: "needs_attention",
      summary:
        typeof blocker === "string" && blocker.trim()
          ? `Workflow ${status}: ${blocker}`
          : status === "blocked"
            ? "Workflow is blocked."
            : "Workflow failed.",
    };
  }
  return result;
}
