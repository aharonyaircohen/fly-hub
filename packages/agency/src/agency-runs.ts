import type { Octokit } from "@octokit/rest";

import {
  listStoredAgencyRuns,
  listStoredRunEvents,
  type StoredAgencyRun,
} from "./backend/agency-runs-store";

export {
  listStoredAgencyRuns,
  listStoredRunEvents,
  type StoredAgencyRun,
  type StoredRunEvent,
} from "./backend/agency-runs-store";

export type AgencyRunKind = "loop" | "workflow" | "capability";
export type AgencyRunOrigin = "manual" | "scheduled" | "event" | "local";
export type AgencyRunStatus =
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "stuck"
  | "blocked"
  | "cancelled"
  | "recorded";

export interface AgencyRunSummary {
  id: string;
  kind: AgencyRunKind;
  targetId: string;
  targetLabel: string;
  targetModel: string | null;
  origin: AgencyRunOrigin;
  status: AgencyRunStatus;
  title: string;
  summary: string | null;
  currentStep: string | null;
  decision: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  kodyRunId: string | null;
  githubRunId: string | null;
  githubRunUrl: string | null;
  logUrl: string | null;
  statePath: string | null;
  sourcePath: string | null;
  action: string | null;
  capability: string | null;
  workflow: string | null;
  parentRunId?: string | null;
  agent: string | null;
  model: string | null;
  modelProvider: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
  actor: string | null;
}

export interface AgencyRunsPayload {
  runs: AgencyRunSummary[];
  counts: Record<AgencyRunKind, number>;
  computedAt: string;
  source: {
    path: "convex:agencyRuns";
    updatedAt: string | null;
    etag: null;
  };
}

export interface AgencyRunWorkflowLogInsight {
  jobId: string;
  jobName: string | null;
  status: "completed" | "failed" | "recorded";
  summary: string | null;
  lines: string[];
  evidenceLines: string[];
}

export interface AgencyRunDetailPayload {
  path: string;
  htmlUrl: string | null;
  events: Array<Record<string, unknown>>;
  workflowLog: AgencyRunWorkflowLogInsight | null;
  computedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function targetId(run: Record<string, unknown>, stored: StoredAgencyRun) {
  return string(record(run.target)?.id) ?? stored.subjectId;
}

function runStatus(value: unknown): AgencyRunStatus {
  if (value === "queued" || value === "running") return "running";
  if (value === "succeeded" || value === "success") return "success";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "recorded";
}

function summary(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function duration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  return Number.isFinite(start) && Number.isFinite(finish)
    ? Math.max(0, finish - start)
    : null;
}

function normalize(stored: StoredAgencyRun): AgencyRunSummary | null {
  const run = record(stored.run);
  if (!run) return null;
  const id = string(run.id) ?? stored.runId;
  const kind = stored.subjectType;
  const target = targetId(run, stored);
  const startedAt = string(run.startedAt);
  const finishedAt = string(run.finishedAt);
  const output = summary(run.output);
  const error = string(run.error);
  return {
    id,
    kind,
    targetId: target,
    targetLabel: target,
    targetModel: null,
    origin: "local",
    status: runStatus(run.status),
    title: target,
    summary: error ?? output,
    currentStep: null,
    decision: null,
    startedAt,
    updatedAt: finishedAt ?? stored.updatedAt,
    durationMs: duration(startedAt, finishedAt),
    kodyRunId: id,
    githubRunId: null,
    githubRunUrl: null,
    logUrl: null,
    statePath: string(run.todoId) ? `todos/${string(run.todoId)}.json` : null,
    sourcePath: id,
    action: null,
    capability: kind === "capability" ? target : null,
    workflow: kind === "workflow" ? target : null,
    parentRunId: string(run.parentRunId),
    agent: string(run.agent) ?? "kody",
    model: null,
    modelProvider: null,
    modelName: null,
    reasoningEffort: null,
    actor: null,
  };
}

export async function listAgencyRuns({
  owner,
  repo,
  limit = 50,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  limit?: number;
}): Promise<AgencyRunsPayload> {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const runs = (await listStoredAgencyRuns(owner, repo, bounded))
    .map(normalize)
    .filter((run): run is AgencyRunSummary => run !== null)
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    );
  return {
    runs,
    counts: {
      loop: runs.filter((run) => run.kind === "loop").length,
      workflow: runs.filter((run) => run.kind === "workflow").length,
      capability: runs.filter((run) => run.kind === "capability").length,
    },
    computedAt: new Date().toISOString(),
    source: {
      path: "convex:agencyRuns",
      updatedAt: runs[0]?.updatedAt ?? null,
      etag: null,
    },
  };
}

export async function readAgencyRunDetail({
  owner,
  repo,
  sourcePath,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  sourcePath: string;
  githubRunId?: string | null;
}): Promise<AgencyRunDetailPayload> {
  const events = await listStoredRunEvents(owner, repo, sourcePath);
  return {
    path: sourcePath,
    htmlUrl: null,
    events: events
      .map((entry) => record(entry.event))
      .filter((entry): entry is Record<string, unknown> => entry !== null),
    workflowLog: null,
    computedAt: new Date().toISOString(),
  };
}
