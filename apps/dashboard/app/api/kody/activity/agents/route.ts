import { NextRequest, NextResponse } from "next/server";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { getRequestAuth, verifyRepoReadAccess } from "@kody-ade/base/auth";

function executionCompletion(
  value: unknown,
  repository: string,
  updatedAt: string,
): {
  status: "done" | "failed" | "blocked";
  updatedAt: string;
  url?: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const execution = result.execution;
  if (
    execution === "kody-online" &&
    typeof result.automationId === "string" &&
    typeof result.automationKind === "string" &&
    typeof result.operation === "string"
  ) {
    return { status: "done", updatedAt };
  }
  if (!execution || typeof execution !== "object" || Array.isArray(execution))
    return null;
  const record = execution as Record<string, unknown>;
  if (
    record.status !== "success" &&
    record.status !== "failed" &&
    record.status !== "blocked"
  )
    return null;
  if (typeof record.completedAt !== "string") return null;
  const githubRunId =
    typeof record.githubRunId === "string" && /^\d+$/.test(record.githubRunId)
      ? record.githubRunId
      : null;
  return {
    status: record.status === "success" ? "done" : record.status,
    updatedAt: record.completedAt,
    ...(githubRunId
      ? { url: `https://github.com/${repository}/actions/runs/${githubRunId}` }
      : {}),
  };
}

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "repository_required" }, { status: 400 });
  const requested = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(100, Math.floor(requested)))
    : 50;
  try {
    const backend = createBackendClient();
    const result = await backend.query(backendApi.agentRuns.listDetailed, {
      tenantId: `${auth.owner}/${auth.repo}`,
      limit,
      now: new Date().toISOString(),
    });
    const runs = await Promise.all(
      result.runs.map(async (run) => {
        const workRecordId =
          "workRecordId" in run ? run.workRecordId : undefined;
        if (!workRecordId) return { ...run, approvals: [] };
        const approvals = await backend.query(
          backendApi.mcpApprovalRequests.listForWork,
          {
            tenantId: `${auth.owner}/${auth.repo}`,
            workRecordId,
            limit: 100,
          },
        );
        return {
          ...run,
          approvals: await Promise.all(
            approvals.map(async (approval) => {
              const completedExecution = executionCompletion(
                approval.result,
                `${auth.owner}/${auth.repo}`,
                approval.updatedAt,
              );
              const storedExecution =
                approval.targetKind === "workflow" && !completedExecution
                  ? await backend.query(backendApi.workflowRuns.get, {
                      tenantId: `${auth.owner}/${auth.repo}`,
                      workflowId: approval.workflowId,
                      runId: approval.runId,
                    })
                  : null;
              const execution =
                completedExecution ??
                (storedExecution
                  ? {
                      status: storedExecution.state.status,
                      updatedAt: storedExecution.updatedAt,
                    }
                  : null);
              return {
                requestId: approval.requestId,
                workRecordId: approval.workRecordId,
                targetKind: approval.targetKind,
                workflowId: approval.workflowId,
                executionRunId: approval.runId,
                mode: approval.mode,
                status: approval.status,
                createdAt: approval.createdAt,
                updatedAt: approval.updatedAt,
                ...(approval.decidedAt
                  ? { decidedAt: approval.decidedAt }
                  : {}),
                ...(approval.decidedBy
                  ? { decidedBy: approval.decidedBy }
                  : {}),
                ...(execution ? { execution } : {}),
              };
            }),
          ),
        };
      }),
    );
    return NextResponse.json(
      { ...result, runs },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "agent_activity_unavailable" },
      { status: 503 },
    );
  }
}
