/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary Workflow runs, default-branch CI roll-up (GraphQL, stale fallback), check runs, workflow dispatch/cancel/rerun.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from "@octokit/rest";
import { WORKFLOW_ID, CACHE_TTL, BRANCH_CACHE_TTL } from "../constants";
import type { WorkflowRun, CheckRunResult } from "../types";
import {
  getCached,
  getStale,
  setCache,
  getOctokit,
  getOwner,
  getRepo,
  invalidateWorkflowCache,
} from "./core";
// ============ Workflow Runs ============

/**
 * Fetch workflow runs for the Kody workflow
 */
export async function fetchWorkflowRuns(options?: {
  status?: "queued" | "in_progress" | "completed";
  perPage?: number;
}): Promise<WorkflowRun[]> {
  const cacheKey = `workflows:${getOwner()}:${getRepo()}:${JSON.stringify(options)}`;
  const cached = getCached<WorkflowRun[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightWorkflowRuns.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<WorkflowRun[]>(cacheKey);
  const octokit = getOctokit();

  const promise = (async () => {
    let response;
    try {
      response = await octokit.actions.listWorkflowRuns({
        owner: getOwner(),
        repo: getRepo(),
        workflow_id: WORKFLOW_ID,
        status: options?.status,
        per_page: options?.perPage || 20,
        headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
      });
    } catch (err: any) {
      if (err.status === 304 && stale) {
        setCache(cacheKey, CACHE_TTL.pipeline, stale.data, {
          etag: stale.etag,
        });
        return stale.data;
      }
      throw err;
    }

    const data = response.data;
    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;

    const runs: WorkflowRun[] = data.workflow_runs.map((run) => ({
      id: run.id,
      status: run.status as "queued" | "in_progress" | "completed",
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      html_url: run.html_url,
      display_title: (run as any).display_title ?? "",
      head_branch: (run as any).head_branch ?? undefined,
      event: (run as any).event ?? undefined,
      run_number: (run as any).run_number ?? undefined,
      run_attempt: (run as any).run_attempt ?? undefined,
      actor: (run as any).triggering_actor?.login ?? (run as any).actor?.login,
    }));

    setCache(cacheKey, CACHE_TTL.pipeline, runs, { etag: newEtag });
    return runs;
  })().finally(() => {
    inflightWorkflowRuns.delete(cacheKey);
  });

  inflightWorkflowRuns.set(cacheKey, promise);
  return promise;
}

const inflightWorkflowRuns = new Map<string, Promise<WorkflowRun[]>>();

// ============ Default-branch CI roll-up ============
//
// Used by the dashboard banner to surface whether `main` is currently green
// or red. Autonomous agents start work from the default branch, so a red
// main is a blocker — operators want to see this before drilling into tasks.
//
// Cached with ETag/304 + 30s TTL per the rate-limit rules in CLAUDE.md.
// Webhook receiver invalidates via invalidateWorkflowCache() on workflow_run /
// check_run / push events.

export interface DefaultBranchCI {
  /** Aggregate state across the latest run of each distinct workflow on main. */
  state: "success" | "failure" | "pending" | "unknown";
  /** Default branch name (usually 'main'). */
  branch: string;
  /** Latest commit SHA on the default branch (when known). */
  sha?: string;
  /** Latest workflow run on main, regardless of conclusion. */
  latestRun?: {
    id: number;
    name: string;
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  };
  /** All currently-failing latest-runs on main. Empty when state !== 'failure'. */
  failingRuns: Array<{
    id: number;
    name: string;
    conclusion: string;
    html_url: string;
    updated_at: string;
  }>;
  /** When data was sampled (ISO). */
  fetchedAt: string;
}

const DEFAULT_BRANCH_CI_TTL = 30_000;

async function getDefaultBranch(): Promise<string> {
  const cacheKey = `branch:default:${getOwner()}:${getRepo()}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const { data } = await getOctokit().repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  const branch = data.default_branch;
  setCache(cacheKey, BRANCH_CACHE_TTL, branch);
  return branch;
}

interface DefaultBranchCIGraphQL {
  repository: {
    defaultBranchRef: {
      name: string;
      target: {
        oid: string;
        statusCheckRollup: {
          state: "EXPECTED" | "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
          contexts: {
            nodes: Array<
              | {
                  __typename: "CheckRun";
                  name: string;
                  status:
                    | "QUEUED"
                    | "IN_PROGRESS"
                    | "COMPLETED"
                    | "WAITING"
                    | "PENDING"
                    | "REQUESTED";
                  conclusion:
                    | "ACTION_REQUIRED"
                    | "TIMED_OUT"
                    | "CANCELLED"
                    | "FAILURE"
                    | "SUCCESS"
                    | "NEUTRAL"
                    | "SKIPPED"
                    | "STARTUP_FAILURE"
                    | "STALE"
                    | null;
                  permalink: string;
                  startedAt: string | null;
                  completedAt: string | null;
                }
              | {
                  __typename: "StatusContext";
                  context: string;
                  state:
                    | "EXPECTED"
                    | "ERROR"
                    | "FAILURE"
                    | "PENDING"
                    | "SUCCESS";
                  targetUrl: string | null;
                  createdAt: string;
                }
            >;
          };
        } | null;
      } | null;
    } | null;
  };
}

/**
 * Roll-up of CI status at HEAD of the default branch.
 *
 * Uses GraphQL `statusCheckRollup` — the exact field GitHub uses to render the
 * green/red checkmark on a commit. This folds together check runs, statuses,
 * and required-checks rules, so the banner mirrors what you see on the commit
 * page in GitHub.
 *
 * Earlier iterations queried `actions.listWorkflowRunsForRepo` (returned stale
 * runs from disabled workflows) and `checks.listForRef` (returned check runs
 * that GitHub's UI sometimes intentionally ignores in the rollup). Neither
 * matched the visible status, so the banner reported failure when the commit
 * was actually green.
 */
export async function fetchDefaultBranchCI(): Promise<DefaultBranchCI> {
  const branch = await getDefaultBranch();
  const cacheKey = `workflows:main-ci:${getOwner()}:${getRepo()}:${branch}`;
  const cached = getCached<DefaultBranchCI>(cacheKey);
  if (cached) return cached;

  const stale = getStale<DefaultBranchCI>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query DefaultBranchCI($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        defaultBranchRef {
          name
          target {
            ... on Commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      permalink
                      startedAt
                      completedAt
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let data: DefaultBranchCIGraphQL;
  try {
    data = await octokit.graphql<DefaultBranchCIGraphQL>(query, {
      owner: getOwner(),
      repo: getRepo(),
    });
  } catch {
    // Refresh TTL on the stale entry so GraphQL throttling doesn't compound
    // (CLAUDE.md rule 3 — GraphQL has its own bucket and no 304 escape hatch).
    if (stale) {
      setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, stale.data);
      return stale.data;
    }
    throw new Error("Failed to fetch default-branch CI rollup");
  }

  const ref = data.repository.defaultBranchRef;
  const target = ref?.target;
  const rollup = target?.statusCheckRollup;

  if (!ref || !target || !rollup) {
    // No commit on default branch yet, or the commit has no checks/statuses.
    // Treat as 'unknown' so the banner reads cleanly.
    const result: DefaultBranchCI = {
      state: "unknown",
      branch: ref?.name ?? branch,
      sha: target?.oid,
      failingRuns: [],
      fetchedAt: new Date().toISOString(),
    };
    setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, result);
    return result;
  }

  let state: DefaultBranchCI["state"];
  switch (rollup.state) {
    case "SUCCESS":
      state = "success";
      break;
    case "FAILURE":
    case "ERROR":
      state = "failure";
      break;
    case "PENDING":
    case "EXPECTED":
      state = "pending";
      break;
    default:
      state = "unknown";
  }

  const failingRuns: DefaultBranchCI["failingRuns"] = [];
  let mostRecent:
    | {
        id: number;
        name: string;
        status: "queued" | "in_progress" | "completed";
        conclusion: string | null;
        html_url: string;
        updated_at: string;
      }
    | undefined;

  for (const node of rollup.contexts.nodes) {
    if (node.__typename === "CheckRun") {
      const ts = node.completedAt ?? node.startedAt ?? new Date().toISOString();
      const checkStatus =
        node.status === "COMPLETED"
          ? "completed"
          : node.status === "IN_PROGRESS"
            ? "in_progress"
            : "queued";
      const isFailure =
        node.conclusion === "FAILURE" ||
        node.conclusion === "TIMED_OUT" ||
        node.conclusion === "ACTION_REQUIRED" ||
        node.conclusion === "STARTUP_FAILURE";
      if (isFailure && node.conclusion) {
        failingRuns.push({
          id: 0,
          name: node.name,
          conclusion: node.conclusion.toLowerCase(),
          html_url: node.permalink,
          updated_at: ts,
        });
      }
      if (!mostRecent || ts > mostRecent.updated_at) {
        mostRecent = {
          id: 0,
          name: node.name,
          status: checkStatus,
          conclusion: node.conclusion ? node.conclusion.toLowerCase() : null,
          html_url: node.permalink,
          updated_at: ts,
        };
      }
    } else {
      // StatusContext — legacy commit-status API (e.g. external CI integrations).
      const isFailure = node.state === "FAILURE" || node.state === "ERROR";
      const checkStatus =
        node.state === "PENDING" ? "in_progress" : "completed";
      if (isFailure) {
        failingRuns.push({
          id: 0,
          name: node.context,
          conclusion: node.state.toLowerCase(),
          html_url: node.targetUrl ?? "",
          updated_at: node.createdAt,
        });
      }
      if (!mostRecent || node.createdAt > mostRecent.updated_at) {
        mostRecent = {
          id: 0,
          name: node.context,
          status: checkStatus,
          conclusion: node.state.toLowerCase(),
          html_url: node.targetUrl ?? "",
          updated_at: node.createdAt,
        };
      }
    }
  }

  // Sanity: if the rollup says SUCCESS, drop any stragglers we collected as
  // 'failing'. statusCheckRollup is authoritative — individual contexts may be
  // marked failure but ignored by GitHub's rollup (e.g. soft-failure required
  // checks, contexts superseded by a later run).
  const reconciledFailingRuns = state === "success" ? [] : failingRuns;

  const result: DefaultBranchCI = {
    state,
    branch: ref.name,
    sha: target.oid,
    latestRun: mostRecent,
    failingRuns: reconciledFailingRuns,
    fetchedAt: new Date().toISOString(),
  };

  setCache(cacheKey, DEFAULT_BRANCH_CI_TTL, result);
  return result;
}

/**
 * Get workflow run for a specific task
 */
export async function getWorkflowRunForTask(
  taskId: string,
): Promise<WorkflowRun | null> {
  const runs = await fetchWorkflowRuns({ perPage: 50 });
  // Look for run with the task ID in the head_branch or workflow run name
  return (
    runs.find(
      (run) =>
        run.html_url.includes(taskId) || taskId.includes(run.id.toString()),
    ) || null
  );
}

/**
 * Fetch check runs (lint, test, typecheck, etc.) for a workflow run
 */
export async function fetchCheckRunsForRun(
  runId: number,
): Promise<CheckRunResult[]> {
  const cacheKey = `check-runs:${getOwner()}:${getRepo()}:${runId}`;
  const cached = getCached<CheckRunResult[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    // Get jobs for the workflow run - these contain lint, test, typecheck results
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      owner: getOwner(),
      repo: getRepo(),
      run_id: runId,
      per_page: 50,
    });

    const checkRuns: CheckRunResult[] = (data.jobs as any[]).map((job) => ({
      name: job.name,
      status: job.status as "queued" | "in_progress" | "completed",
      conclusion: job.conclusion as CheckRunResult["conclusion"],
      output: job.steps
        ? {
            summary: `${job.steps.length} steps`,
            text: JSON.stringify(
              job.steps.map((s: any) => ({
                name: s.name,
                status: s.status,
                conclusion: s.conclusion,
              })),
            ),
          }
        : undefined,
      html_url: job.html_url || undefined,
    }));

    setCache(cacheKey, CACHE_TTL.pipeline, checkRuns);
    return checkRuns;
  } catch (error) {
    console.error("[Kody] Error fetching check runs:", error);
    return [];
  }
}

export async function triggerWorkflow(
  options: {
    taskId: string;
    mode?: string;
    fromStage?: string;
    feedback?: string;
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.actions.createWorkflowDispatch({
    owner: getOwner(),
    repo: getRepo(),
    workflow_id: WORKFLOW_ID,
    ref: "main",
    inputs: {
      task_id: options.taskId,
      mode: options.mode || "full",
      from_stage: options.fromStage || "",
      feedback: options.feedback || "",
    },
  });
}

/**
 * Cancel a workflow run
 */
export async function cancelWorkflowRun(
  runId: number,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.actions.cancelWorkflowRun({
    owner: getOwner(),
    repo: getRepo(),
    run_id: runId,
  });
}

/**
 * Re-run a completed workflow run. Used by the dashboard's "Re-run jobs"
 * affordance on a red default-branch CI row.
 */
export async function rerunWorkflowRun(
  runId: number,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.actions.reRunWorkflow({
    owner: getOwner(),
    repo: getRepo(),
    run_id: runId,
  });
}

