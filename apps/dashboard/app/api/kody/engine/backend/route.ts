import { NextResponse } from "next/server";
import { z } from "zod";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const requestSchema = z.object({
  kind: z.enum(["query", "mutation"]),
  operation: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()).default({}),
});

const operations = {
  "taskState.get": { kind: "query", fn: backendApi.taskState.get },
  "taskState.save": { kind: "mutation", fn: backendApi.taskState.save },
  "agentStates.get": { kind: "query", fn: backendApi.agentStates.get },
  "agentStates.save": { kind: "mutation", fn: backendApi.agentStates.save },
  "repoDocs.get": { kind: "query", fn: backendApi.repoDocs.get },
  "repoDocs.listByPrefix": {
    kind: "query",
    fn: backendApi.repoDocs.listByPrefix,
  },
  "repoDocs.save": { kind: "mutation", fn: backendApi.repoDocs.save },
  "dailyLogs.append": { kind: "mutation", fn: backendApi.dailyLogs.append },
  "chatEvents.append": { kind: "mutation", fn: backendApi.chatEvents.append },
  "conversations.get": { kind: "query", fn: backendApi.conversations.get },
  "conversations.appendEntry": {
    kind: "mutation",
    fn: backendApi.conversations.appendEntry,
  },
  "agencyRuns.save": { kind: "mutation", fn: backendApi.agencyRuns.save },
  "agencyRequestLoops.list": {
    kind: "query",
    fn: backendApi.agencyRequestLoops.list,
  },
  "loopWakes.replaceRegistrations": {
    kind: "mutation",
    fn: backendApi.loopWakes.replaceRegistrations,
  },
  "loopWakes.markExecution": {
    kind: "mutation",
    fn: backendApi.loopWakes.markExecution,
  },
  "agencyModel.reserveDispatch": {
    kind: "mutation",
    fn: backendApi.agencyModel.reserveDispatch,
  },
  "agencyModel.renewDispatch": {
    kind: "mutation",
    fn: backendApi.agencyModel.renewDispatch,
  },
  "agencyModel.recordSkippedDispatch": {
    kind: "mutation",
    fn: backendApi.agencyModel.recordSkippedDispatch,
  },
  "agencyModel.finishDispatch": {
    kind: "mutation",
    fn: backendApi.agencyModel.finishDispatch,
  },
  "agencyModel.createRunRecord": {
    kind: "mutation",
    fn: backendApi.agencyModel.createRunRecord,
  },
  "agencyModel.finishRunRecord": {
    kind: "mutation",
    fn: backendApi.agencyModel.finishRunRecord,
  },
  "runEvents.append": { kind: "mutation", fn: backendApi.runEvents.append },
  "manifests.get": { kind: "query", fn: backendApi.manifests.get },
  "reports.save": { kind: "mutation", fn: backendApi.reports.save },
  "reports.list": { kind: "query", fn: backendApi.reports.list },
  "definitions.listCurrent": {
    kind: "query",
    fn: backendApi.definitions.listCurrent,
  },
  "workflows.list": { kind: "query", fn: backendApi.workflows.list },
  "workflowRuns.get": { kind: "query", fn: backendApi.workflowRuns.get },
  "workflowRuns.save": { kind: "mutation", fn: backendApi.workflowRuns.save },
  "workflowRunLeases.acquire": {
    kind: "mutation",
    fn: backendApi.workflowRunLeases.acquire,
  },
  "workflowRunLeases.renew": {
    kind: "mutation",
    fn: backendApi.workflowRunLeases.renew,
  },
  "workflowRunLeases.release": {
    kind: "mutation",
    fn: backendApi.workflowRunLeases.release,
  },
} as const;

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "missing_workflow_identity" },
      { status: 401 },
    );
  }

  let identity;
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

  const selected = operations[parsed.data.operation as keyof typeof operations];
  if (!selected || selected.kind !== parsed.data.kind) {
    return NextResponse.json(
      { error: "unsupported_operation" },
      { status: 400 },
    );
  }

  const {
    tenantId: _ignoredTenant,
    serviceKey: _ignoredKey,
    ...callerArgs
  } = parsed.data.args;
  const args = { ...callerArgs, tenantId: identity.repository };

  try {
    const client = createBackendClient();
    const result =
      selected.kind === "query"
        ? await client.query(selected.fn as never, args as never)
        : await client.mutation(selected.fn as never, args as never);
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Kody engine backend request failed", {
      operation: parsed.data.operation,
      repository: identity.repository,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "backend_request_failed" },
      { status: 500 },
    );
  }
}
