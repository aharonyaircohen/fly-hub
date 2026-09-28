import {
  SYSTEM_EVENT_CATALOG,
  type SystemEventName,
} from "@kody-ade/base/events/catalog";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";

interface WorkflowRunPayload {
  action?: string;
  workflow_run?: {
    id?: number;
    run_attempt?: number | null;
    name?: string | null;
    path?: string | null;
    workflow_id?: number | null;
    conclusion?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    event?: string | null;
    html_url?: string | null;
    pull_requests?: Array<{ number?: number | null }> | null;
  };
  repository?: { full_name?: string };
  sender?: { id?: number; login?: string };
}

const conclusions = new Set([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
]);

/** Convert one supported GitHub webhook into Kody's typed event envelope. */
export function normalizeGitHubWebhookEvent(input: {
  eventType: string;
  deliveryId: string;
  payload: unknown;
  now?: () => string;
}): SystemEventEnvelope | null {
  if (input.eventType !== "workflow_run") return null;
  if (!input.deliveryId) return null;
  if (!input.payload || typeof input.payload !== "object") return null;
  const payload = input.payload as WorkflowRunPayload;
  if (payload.action !== "completed") return null;

  const run = payload.workflow_run;
  const repository = payload.repository?.full_name;
  if (
    typeof run?.id !== "number" ||
    !Number.isSafeInteger(run.id) ||
    typeof repository !== "string" ||
    repository.trim().length === 0 ||
    (run.conclusion !== null &&
      run.conclusion !== undefined &&
      !conclusions.has(run.conclusion))
  ) {
    return null;
  }

  const repositoryName = repository.trim();
  const parts = repositoryName.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;

  const name: SystemEventName = "github.workflow_run.completed";
  const pullRequestNumbers = [
    ...new Set(
      (Array.isArray(run.pull_requests) ? run.pull_requests : [])
        .map((pullRequest) => pullRequest?.number)
        .filter(
          (number): number is number =>
            typeof number === "number" &&
            Number.isSafeInteger(number) &&
            number > 0,
        ),
    ),
  ];
  const candidate = {
    runId: run.id,
    ...(typeof run.run_attempt === "number"
      ? { runAttempt: run.run_attempt }
      : {}),
    ...(typeof run.workflow_id === "number"
      ? { workflowId: run.workflow_id }
      : {}),
    ...(run.name ? { workflowName: run.name } : {}),
    ...(run.path ? { workflowPath: run.path } : {}),
    conclusion: run.conclusion ?? null,
    ...(run.head_branch ? { branch: run.head_branch } : {}),
    ...(run.head_sha ? { headSha: run.head_sha } : {}),
    ...(pullRequestNumbers.length === 1 ? { pr: pullRequestNumbers[0] } : {}),
    ...(run.event ? { event: run.event } : {}),
    repository: repositoryName,
    ...(payload.sender?.login ? { actor: payload.sender.login } : {}),
    ...(run.html_url ? { htmlUrl: run.html_url } : {}),
  };
  const parsed = SYSTEM_EVENT_CATALOG[name].schema.safeParse(candidate);
  if (!parsed.success) return null;

  return {
    id: input.deliveryId,
    name,
    version: SYSTEM_EVENT_CATALOG[name].version,
    occurredAt: input.now?.() ?? new Date().toISOString(),
    userId:
      typeof payload.sender?.id === "number"
        ? `github:${payload.sender.id}`
        : null,
    sessionId: null,
    brand: { owner, repo },
    source: "server",
    payload: parsed.data,
  };
}
