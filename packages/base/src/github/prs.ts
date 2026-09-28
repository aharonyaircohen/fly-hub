/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary Bulk PR fetch (GraphQL, in-flight dedup, stale fallback), PR discovery, preview URLs, PR comments/files, close.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from "@octokit/rest";
import { BRANCH_PREFIXES, CACHE_TTL } from "@kody-ade/base/constants";
import type { GitHubPR, PRComment, FileChange } from "@kody-ade/base/types";
import {
  getCached,
  getStale,
  setCache,
  getOctokit,
  getOwner,
  getRepo,
  invalidatePRCache,
} from "@kody-ade/base/github/core";
import { findBranchByIssueNumber } from "./branches";
import { fetchIssue } from "@kody-ade/base/github/issues";
// ============ Bulk PR Fetch ============

type CIStatus = "pending" | "success" | "failure" | "running";

type MergeStateStatus =
  | "CLEAN"
  | "DIRTY"
  | "BLOCKED"
  | "BEHIND"
  | "UNKNOWN"
  | "UNSTABLE"
  | "HAS_HOOKS";

type RollupState = "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";

interface OpenPRsGraphQL {
  repository: {
    pullRequests: {
      nodes: Array<{
        databaseId: number;
        number: number;
        title: string;
        state: "OPEN" | "CLOSED" | "MERGED";
        url: string;
        mergedAt: string | null;
        headRefName: string;
        headRefOid: string;
        baseRefName: string;
        body: string | null;
        mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
        mergeStateStatus: MergeStateStatus;
        labels: { nodes: Array<{ name: string }> };
        isDraft: boolean;
        closingIssuesReferences: { nodes: Array<{ number: number }> };
        commits: {
          nodes: Array<{
            commit: {
              statusCheckRollup: { state: RollupState } | null;
            };
          }>;
        };
      }>;
    };
  };
}

function mapRollupState(state: RollupState | null | undefined): CIStatus {
  if (!state) return "success"; // no checks configured — nothing to wait for
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
      return "running";
    case "EXPECTED":
    default:
      return "pending";
  }
}

/**
 * Derive CI status + mergeability from GitHub's mergeStateStatus and the
 * statusCheckRollup. Centralized here so both /tasks and consumers see a
 * single source of truth for the CI badge / merge-button state.
 */
function derivePRCi(input: {
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: MergeStateStatus;
  rollupState: RollupState | null;
}): { ciStatus: CIStatus; mergeable: boolean; hasConflicts: boolean } {
  const noConflicts = input.mergeable === "MERGEABLE";
  let ciStatus: CIStatus;
  let hasConflicts = false;

  switch (input.mergeStateStatus) {
    case "CLEAN":
      ciStatus = "success";
      break;
    case "UNSTABLE":
      // Mergeable, non-required check failed — surface real CI status.
      ciStatus = mapRollupState(input.rollupState);
      break;
    case "BLOCKED":
      // Steady state for repos without branch protection — fall back to rollup.
      ciStatus = noConflicts ? mapRollupState(input.rollupState) : "running";
      break;
    case "BEHIND":
    case "HAS_HOOKS":
      ciStatus = "running";
      break;
    case "DIRTY":
      // DIRTY = merge conflicts, not a CI failure. Surface the actual rollup
      // state so the badge reflects what the checks actually say (e.g. all
      // green on a PR that's just behind main). hasConflicts stays true so
      // the conflict banner still renders separately.
      ciStatus = input.rollupState
        ? mapRollupState(input.rollupState)
        : "pending";
      hasConflicts = true;
      break;
    case "UNKNOWN":
    default:
      ciStatus = "pending";
  }

  const mergeable =
    noConflicts &&
    ciStatus !== "pending" &&
    ciStatus !== "running" &&
    (ciStatus === "success" ||
      input.mergeStateStatus === "CLEAN" ||
      input.mergeStateStatus === "UNSTABLE");

  return { ciStatus, mergeable, hasConflicts };
}

// Non-closing issue references in PR bodies. Currently:
//   Tracking-Issue: #1352
// The release-prepare script writes this so the dashboard can preview the
// release PR on the originating issue's task without auto-closing the issue
// on merge (see kody2/src/implementations/release-prepare/prepare.sh).
const TRACKING_ISSUE_RE = /(?:^|\n)\s*Tracking-Issue\s*:\s*#(\d+)\b/gi;

function parseTrackingIssueRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  const out = new Set<number>();
  for (const m of body.matchAll(TRACKING_ISSUE_RE)) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out];
}

/**
 * Fetch all open PRs in one GraphQL call. Returns each PR with the issue
 * numbers it links via "Closes/Fixes/Resolves #N" so the dashboard can match
 * PRs to tasks without parsing branch names.
 *
 * GraphQL doesn't expose ETag/304 the way REST does, so the rate-limit budget
 * relies on:
 * - The `CACHE_TTL.prs` cache (5min) keeping fresh polls off the wire.
 * - In-flight dedup (concurrent callers in the same instance share one query).
 * - A stale fallback: if GitHub throttles or errors, return the previous list
 *   instead of bubbling the failure (and instead of retrying immediately).
 */
const inflightOpenPRs = new Map<string, Promise<GitHubPR[]>>();

export async function fetchOpenPRs(): Promise<GitHubPR[]> {
  const cacheKey = `open-prs:${getOwner()}:${getRepo()}`;
  const cached = getCached<GitHubPR[]>(cacheKey);
  if (cached) return cached;

  const existing = inflightOpenPRs.get(cacheKey);
  if (existing) return existing;

  const stale = getStale<GitHubPR[]>(cacheKey);
  const octokit = getOctokit();

  const query = `
    query OpenPRs($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            state
            url
            mergedAt
            headRefName
            headRefOid
            baseRefName
            body
            mergeable
            mergeStateStatus
            labels(first: 20) { nodes { name } }
            isDraft
            closingIssuesReferences(first: 10) { nodes { number } }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup { state }
                }
              }
            }
          }
        }
      }
    }
  `;

  const promise = (async () => {
    try {
      const data = await octokit.graphql<OpenPRsGraphQL>(query, {
        owner: getOwner(),
        repo: getRepo(),
      });

      const prs: GitHubPR[] = data.repository.pullRequests.nodes.map((pr) => {
        const rollupState =
          pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
        const ci = derivePRCi({
          mergeable: pr.mergeable,
          mergeStateStatus: pr.mergeStateStatus,
          rollupState,
        });
        return {
          id: pr.databaseId,
          number: pr.number,
          title: pr.title,
          state: pr.state.toLowerCase(),
          head: { ref: pr.headRefName, sha: pr.headRefOid },
          base: { ref: pr.baseRefName },
          merged_at: pr.mergedAt,
          html_url: pr.url,
          labels: pr.labels.nodes.map((l) => l.name).filter(Boolean),
          closingIssueNumbers: pr.closingIssuesReferences.nodes.map(
            (n) => n.number,
          ),
          trackingIssueNumbers: parseTrackingIssueRefs(pr.body),
          ciStatus: ci.ciStatus,
          mergeable: ci.mergeable,
          hasConflicts: ci.hasConflicts,
          isDraft: pr.isDraft,
        };
      });

      setCache(cacheKey, CACHE_TTL.prs, prs);
      return prs;
    } catch (err) {
      if (stale) {
        // Refresh the TTL on stale data so we don't hammer GraphQL on every
        // subsequent poll while we're being throttled.
        setCache(cacheKey, Math.min(CACHE_TTL.prs, 60_000), stale.data);
        return stale.data;
      }
      throw err;
    } finally {
      inflightOpenPRs.delete(cacheKey);
    }
  })();

  inflightOpenPRs.set(cacheKey, promise);
  return promise;
}

/**
 * Returns how many commits the PR head branch is behind its base. Used to
 * gate the Preview "Sync" button — when 0, the branch is already up to date
 * and the button is hidden.
 *
 * Cheap to call: 60s TTL with ETag/304 revalidation, so subsequent polls
 * only re-bill the rate limit when the comparison actually changes. Fails
 * soft to 0 (treat as up-to-date) on transient errors so we don't surface
 * a stale Sync button.
 */
const PR_BEHIND_TTL = 60_000;

export async function fetchPRBehind(
  base: string,
  head: string,
): Promise<number> {
  const cacheKey = `prbehind:${getOwner()}:${getRepo()}:${base}...${head}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  const stale = getStale<number>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.compareCommitsWithBasehead({
      owner: getOwner(),
      repo: getRepo(),
      basehead: `${base}...${head}`,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
    const behindBy = response.data.behind_by ?? 0;
    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    setCache(cacheKey, PR_BEHIND_TTL, behindBy, { etag: newEtag });
    return behindBy;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 304 && stale) {
      setCache(cacheKey, PR_BEHIND_TTL, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (stale) {
      setCache(cacheKey, PR_BEHIND_TTL, stale.data);
      return stale.data;
    }
    throw err;
  }
}

// ============ Vercel Preview URLs ============

type DeploymentSummary = { id: number; sha: string };

// Short TTL for the deployments list and per-deployment status: a new PR
// commit creates a new deployment within seconds, and we want the dashboard
// to surface its preview URL on the next /tasks poll. With ETag/304 the
// short TTL is essentially free — unchanged data revalidates without
// counting against the rate limit.
const PREVIEW_REVALIDATE_TTL = 30_000;

/**
 * Fetch (or revalidate via ETag) the most recent 100 Preview deployments.
 * Cached by owner/repo only — independent of which SHAs the caller wants —
 * so a new PR push doesn't invalidate the entire derived view, just forces
 * a cheap 200 (when truly new) or 304 (free) on the underlying list.
 */
async function getRecentPreviewDeployments(): Promise<DeploymentSummary[]> {
  // Prefix with `previews:` so invalidatePRCache() catches this key.
  const cacheKey = `previews:list:${getOwner()}:${getRepo()}`;
  const cached = getCached<DeploymentSummary[]>(cacheKey);
  if (cached) return cached;

  const stale = getStale<DeploymentSummary[]>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.listDeployments({
      owner: getOwner(),
      repo: getRepo(),
      environment: "Preview",
      per_page: 100,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });

    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    const summaries: DeploymentSummary[] = response.data.map((d) => ({
      id: d.id,
      sha: d.sha,
    }));
    setCache(cacheKey, PREVIEW_REVALIDATE_TTL, summaries, { etag: newEtag });
    return summaries;
  } catch (error: any) {
    // 304 Not Modified — deployments list unchanged. Reuse stale, no rate cost.
    if (error.status === 304 && stale) {
      setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
        etag: stale.etag,
      });
      return stale.data;
    }
    console.error("[Kody] Error fetching deployment list:", error);
    return stale?.data ?? [];
  }
}

/**
 * Fetch the latest deployment status URL for a deployment, with ETag/304
 * revalidation. Per-deployment URLs change as a deployment progresses
 * (in_progress → success), so we keep a short TTL but pay no quota when
 * unchanged.
 *
 * Returns the URL or `null` (no environment_url, e.g., still building or
 * errored). Cached `null` is also valid — the next call after TTL still
 * revalidates via ETag. We use a presence sentinel inside `data` so a
 * cache hit on a null URL is distinguishable from a cache miss.
 */
async function getDeploymentStatusUrl(
  deploymentId: number,
): Promise<string | null> {
  // Prefix with `previews:` so invalidatePRCache() catches this key.
  const cacheKey = `previews:status:${getOwner()}:${getRepo()}:${deploymentId}`;
  const cached = getCached<{ url: string | null }>(cacheKey);
  if (cached) return cached.url;

  const stale = getStale<{ url: string | null }>(cacheKey);
  const octokit = getOctokit();

  try {
    const response = await octokit.repos.listDeploymentStatuses({
      owner: getOwner(),
      repo: getRepo(),
      deployment_id: deploymentId,
      per_page: 1,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });

    const newEtag = (response.headers as Record<string, string | undefined>)
      ?.etag;
    const url = response.data[0]?.environment_url ?? null;
    setCache(cacheKey, PREVIEW_REVALIDATE_TTL, { url }, { etag: newEtag });
    return url;
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
        etag: stale.etag,
      });
      return stale.data.url;
    }
    return null;
  }
}

/**
 * Resolve the Vercel preview URL for a single commit SHA, looked up directly
 * by that commit (not via the recent-100 bulk window). This is the on-demand
 * path used when a preview pane opens: GitHub always answers "what's the
 * Preview deployment for *this* commit?" regardless of how old it is, so it
 * fixes PRs that have aged out of `getRecentPreviewDeployments`'s window.
 *
 * Returns the URL, or `null` when the deployment is still building / has no
 * `environment_url` yet. Both the per-SHA deployment lookup and the status
 * lookup are ETag-revalidated and cached, so repeated opens cost a free 304.
 */
export async function fetchPreviewForSha(sha: string): Promise<string | null> {
  if (!sha) return null;

  const cacheKey = `previews:sha:${getOwner()}:${getRepo()}:${sha}`;
  const cached = getCached<{ id: number | null }>(cacheKey);
  const stale = getStale<{ id: number | null }>(cacheKey);
  const octokit = getOctokit();

  let deploymentId: number | null;
  if (cached) {
    deploymentId = cached.id;
  } else {
    try {
      const response = await octokit.repos.listDeployments({
        owner: getOwner(),
        repo: getRepo(),
        sha,
        environment: "Preview",
        per_page: 1,
        headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
      });
      const newEtag = (response.headers as Record<string, string | undefined>)
        ?.etag;
      deploymentId = response.data[0]?.id ?? null;
      setCache(
        cacheKey,
        PREVIEW_REVALIDATE_TTL,
        { id: deploymentId },
        {
          etag: newEtag,
        },
      );
    } catch (error: any) {
      if (error.status === 304 && stale) {
        setCache(cacheKey, PREVIEW_REVALIDATE_TTL, stale.data, {
          etag: stale.etag,
        });
        deploymentId = stale.data.id;
      } else {
        console.error("[Kody] Error resolving preview for SHA:", error);
        return null;
      }
    }
  }

  if (deploymentId === null) return null;
  return getDeploymentStatusUrl(deploymentId);
}

/**
 * Fetch Vercel preview URLs for a set of PR head SHAs.
 * Strategy: 1 bulk call for the 100 most recent Preview deployments (GitHub's
 * max page size, ETag-revalidated), then 1 status call per matched deployment
 * (also ETag-revalidated and per-deployment cached).
 *
 * Older SHAs that fall outside the 100-deployment window simply don't get a
 * preview URL — accepted tradeoff to avoid the previous per-SHA fanout, which
 * cost 2 extra REST calls per missed PR on every tasks-list poll.
 *
 * No derived per-SHA-list cache: the underlying `getRecentPreviewDeployments`
 * and `getDeploymentStatusUrl` are both cheap (cache hit or free 304), so
 * recomputing the SHA → URL map on each call avoids stale results when a PR
 * pushes a new commit.
 */
export async function fetchDeploymentPreviews(
  prShas: string[],
): Promise<Map<string, string>> {
  if (prShas.length === 0) return new Map();

  const result = new Map<string, string>();
  const deployments = await getRecentPreviewDeployments();
  const shaSet = new Set(prShas);
  const matched = deployments.filter((d) => shaSet.has(d.sha));

  await Promise.all(
    matched.map(async (deployment) => {
      const url = await getDeploymentStatusUrl(deployment.id);
      if (url) result.set(deployment.sha, url);
    }),
  );

  return result;
}

// ============ PR Discovery ============

/**
 * Find PR associated with a task by branch name
 */
export async function findAssociatedPR(
  taskId: string,
): Promise<GitHubPR | null> {
  const cacheKey = `pr:${getOwner()}:${getRepo()}:${taskId}`;
  const cached = getCached<GitHubPR | null>(cacheKey);
  if (cached !== null) return cached;

  const octokit = getOctokit();

  // Try all branch prefixes
  const branchNames = BRANCH_PREFIXES.map((prefix) => `${prefix}/${taskId}`);

  for (const branchName of branchNames) {
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branchName}`,
        state: "open",
      });

      if (data.length > 0) {
        const pr: GitHubPR = {
          id: data[0].id,
          number: data[0].number,
          title: data[0].title,
          state: data[0].state,
          head: {
            ref: data[0].head.ref,
            sha: data[0].head.sha,
          },
          merged_at: data[0].merged_at,
          html_url: data[0].html_url,
        };
        setCache(cacheKey, CACHE_TTL.prs, pr);
        return pr;
      }
    } catch {
      // Try next prefix
    }
  }

  // Cache null as well
  setCache(cacheKey, CACHE_TTL.prs, null);
  return null;
}

/**
 * Find the PR associated with a GitHub issue number.
 * Uses the bulk open-PR list (cached) + branch name pattern matching.
 * This is the preferred method — findAssociatedPR(taskId) only works
 * for branches named exactly {prefix}/{taskId}, which fails for
 * Kody-generated branches like fix/260312-auto-781-title.
 */
export async function findAssociatedPRByIssueNumber(
  issueNumber: number,
): Promise<GitHubPR | null> {
  const cacheKey = `pr:issue:${getOwner()}:${getRepo()}:${issueNumber}`;
  const cached = getCached<GitHubPR | null>(cacheKey);
  if (cached !== null) return cached;

  // 1. Check open PRs (fast, uses cached bulk list).
  // Matching precedence MUST stay in sync with app/api/kody/tasks/route.ts —
  // if the task list shows an associatedPR via one path and this function
  // misses that path, dashboard buttons (approve-pr, close-pr, fix) 404
  // even though the badge is visible.
  const openPRs = await fetchOpenPRs();
  const issueStr = String(issueNumber);

  const sameNumberPr = openPRs.find((pr) => pr.number === issueNumber);
  if (sameNumberPr) {
    setCache(cacheKey, CACHE_TTL.prs, sameNumberPr);
    return sameNumberPr;
  }

  // Highest priority: engine-written `<!-- kody-release-pr: #N -->` marker
  // in the issue body. Persisted by release-prepare/release-deploy so the
  // link survives @kody fix overwrites of the PR body. Mirrors the bulk
  // task list's primary lookup in app/api/kody/tasks/route.ts.
  try {
    const issue = await fetchIssue(issueNumber, { ttl: CACHE_TTL.tasks });
    const marker = issue?.body?.match(
      /<!--\s*kody-release-pr:\s*#?(\d+)\s*-->/i,
    );
    if (marker) {
      const target = parseInt(marker[1]!, 10);
      const matched = openPRs.find((p) => p.number === target);
      if (matched) {
        setCache(cacheKey, CACHE_TTL.prs, matched);
        return matched;
      }
    }
  } catch {
    // Body lookup is best-effort — fall through to bulk-list signals below.
  }

  for (const pr of openPRs) {
    // Strongest signal: GraphQL "Closes/Fixes/Resolves #N" links from the PR body.
    if (pr.closingIssueNumbers?.includes(issueNumber)) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Non-closing tracker (e.g. release-prepare's `Tracking-Issue: #N` —
    // can't use a closing keyword because the orchestrator needs the
    // issue to stay open through publish + deploy after PR merge).
    if (pr.trackingIssueNumbers?.includes(issueNumber)) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Kody-auto branches put the issue number after "-auto-", so check that
    // before the generic first-digits pattern (which would capture YYMMDD).
    const autoMatch = pr.head.ref.match(/-auto-(\d+)-/);
    if (autoMatch && autoMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Traditional: {prefix}/{issueNumber}-{title}
    const branchMatch = pr.head.ref.match(/\/(\d{3,})-/);
    if (!autoMatch && branchMatch && branchMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Flat: {issueNumber}-{title} (no prefix)
    const flatMatch = pr.head.ref.match(/^(\d{3,})-/);
    if (flatMatch && flatMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
    // Match by PR title "Closes #NNN"
    const closesMatch = pr.title.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
    if (closesMatch && closesMatch[1] === issueStr) {
      setCache(cacheKey, CACHE_TTL.prs, pr);
      return pr;
    }
  }

  // 2. Fallback: find branch by issue number and look up PR by head ref
  const branch = await findBranchByIssueNumber(issueNumber);
  if (branch) {
    const octokit = getOctokit();
    try {
      const { data } = await octokit.pulls.list({
        owner: getOwner(),
        repo: getRepo(),
        head: `${getOwner()}:${branch}`,
        state: "open",
      });
      if (data.length > 0) {
        const pr: GitHubPR = {
          id: data[0].id,
          number: data[0].number,
          title: data[0].title,
          state: data[0].state,
          head: { ref: data[0].head.ref, sha: data[0].head.sha },
          merged_at: data[0].merged_at,
          html_url: data[0].html_url,
        };
        setCache(cacheKey, CACHE_TTL.prs, pr);
        return pr;
      }
    } catch {
      // Fall through
    }
  }

  setCache(cacheKey, CACHE_TTL.prs, null);
  return null;
}

/**
 * Fetch comments for a PR
 */
export async function fetchPRComments(prNumber: number): Promise<PRComment[]> {
  const cacheKey = `pr-comments:${getOwner()}:${getRepo()}:${prNumber}`;
  const cached = getCached<PRComment[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    // Paginate to get the full thread. GitHub returns comments ascending by
    // created_at, capped at 100 per page. Most PRs fit in one page; heavily
    // iterated ones (fix-ci/ui-review loops) need 2-3. Octokit's paginate()
    // walks all pages in one call.
    const data = await octokit.paginate(octokit.issues.listComments, {
      owner: getOwner(),
      repo: getRepo(),
      issue_number: prNumber,
      per_page: 100,
    });

    const comments: PRComment[] = data.map((comment) => ({
      id: comment.id,
      body: comment.body || "",
      created_at: comment.created_at,
      user: {
        login: comment.user?.login || "",
        avatar_url: comment.user?.avatar_url || "",
      },
    }));

    setCache(cacheKey, CACHE_TTL.tasks, comments);
    return comments;
  } catch (error) {
    console.error("[Kody] Error fetching PR comments:", error);
    return [];
  }
}

/**
 * Fetch file changes for a PR
 */
export async function fetchPRFileChanges(
  prNumber: number,
): Promise<FileChange[]> {
  const cacheKey = `pr-files:${getOwner()}:${getRepo()}:${prNumber}`;
  const cached = getCached<FileChange[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    const { data } = await octokit.pulls.listFiles({
      owner: getOwner(),
      repo: getRepo(),
      pull_number: prNumber,
      per_page: 100,
    });

    const changes: FileChange[] = data.map((file) => ({
      filename: file.filename,
      status: file.status as FileChange["status"],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch ?? null,
      previousFilename: file.previous_filename,
    }));

    setCache(cacheKey, CACHE_TTL.tasks, changes);
    return changes;
  } catch (error) {
    console.error("[Kody] Error fetching PR files:", error);
    return [];
  }
}

/**
 * Close a PR (without merging)
 */
export async function closePR(
  prNumber: number,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.pulls.update({
    owner: getOwner(),
    repo: getRepo(),
    pull_number: prNumber,
    state: "closed",
  });

  // Invalidate PR cache only
  invalidatePRCache();
}

/**
 * Delete a branch
 */
