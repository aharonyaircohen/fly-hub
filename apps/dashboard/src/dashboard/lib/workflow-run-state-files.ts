/**
 * @fileType utility
 * @domain kody
 * @pattern workflow-run-state-files
 * @ai-summary Read workflow run state from the Convex backend
 *   (workflowRuns.{get,list}, tenant-scoped by owner/repo).
 */
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "./backend/convex-backend";
import {
  latestWorkflowRunDocument,
  normalizeWorkflowRunState,
  type WorkflowRunStateRecord,
} from "./workflow-run-state";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function isWorkflowRunStateId(value: string): boolean {
  return SAFE_ID.test(value);
}

function assertIds(workflowId: string, runId?: string): void {
  if (
    !SAFE_ID.test(workflowId) ||
    (runId !== undefined && !isWorkflowRunStateId(runId))
  ) {
    throw new Error("Invalid workflow or run id");
  }
}

interface WorkflowRunDoc {
  runId: string;
  state: unknown;
  updatedAt?: string;
  _creationTime?: number;
}

export async function readWorkflowRunStateFile(
  owner: string,
  repo: string,
  workflowId: string,
  runId: string,
): Promise<WorkflowRunStateRecord | null> {
  assertIds(workflowId, runId);
  const doc = (await getConvexClient().query(backendApi.workflowRuns.get, {
    tenantId: tenantIdFor(owner, repo),
    workflowId,
    runId,
  })) as WorkflowRunDoc | null;
  if (!doc) return null;
  const state = normalizeWorkflowRunState(doc.state);
  return state ? { workflowId, runId, state } : null;
}

export async function readLatestWorkflowRunStateFile(
  owner: string,
  repo: string,
  workflowId: string,
): Promise<WorkflowRunStateRecord | null> {
  assertIds(workflowId);
  const docs = (await getConvexClient().query(backendApi.workflowRuns.list, {
    tenantId: tenantIdFor(owner, repo),
    workflowId,
  })) as WorkflowRunDoc[];
  const doc = latestWorkflowRunDocument(
    docs.filter((candidate) => isWorkflowRunStateId(candidate.runId)),
  );
  if (!doc) return null;
  const state = doc ? normalizeWorkflowRunState(doc.state) : null;
  return state ? { workflowId, runId: doc.runId, state } : null;
}
