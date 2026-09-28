/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary Issue & comment fetching (ETag/304 + GraphQL fallback), issue CRUD, labels, milestones, collaborators.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from "@octokit/rest";
import { CACHE_TTL } from "../constants";
import { createIssueWithBestEffortMetadata } from "../github-issue-create";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import type { GitHubIssue, GitHubComment, GitHubCollaborator } from "../types";
import {
  cache,
  getCached,
  getStale,
  setCache,
  getOctokit,
  getOwner,
  getRepo,
  invalidateTaskCache,
} from "./core";
// ============ Issue & Comment Fetching ============

/**
 * Fetch a single issue by number (optimized for detail view).
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. capabilities detail).
 * - When the TTL expires, the cached ETag is replayed via `If-None-Match`.
 *   GitHub returns 304 (free, doesn't count against the rate limit) when the
 *   issue is unchanged, and we just refresh the TTL on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssue(
  issueNumber: number,
  options?: { noCache?: boolean; ttl?: number },
): Promise<GitHubIssue | null> {
  const cacheKey = `issue:${getOwner()}:${getRepo()}:${issueNumber}`;
  const ttl = options?.ttl ?? CACHE_TTL.tasks;

  if (!options?.noCache) {
    const cached = getCached<GitHubIssue>(cacheKey);
    if (cached) return cached;
  }

  const stale = options?.noCache ? null : getStale<GitHubIssue>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.get({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (error: any) {
    if (error.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    if (error.status === 404) {
      return null;
    }
    throw error;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const issue: GitHubIssue = {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as "open" | "closed",
    labels: data.labels.map((l: any) =>
      typeof l === "string"
        ? { name: l, color: "000000" }
        : { name: l.name ?? "", color: l.color ?? "000000" },
    ),
    milestone: data.milestone ? { title: data.milestone.title ?? "" } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? "",
        avatar_url: a.avatar_url ?? "",
      })) ?? [],
    created_at: data.created_at ?? "",
    updated_at: data.updated_at ?? "",
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? "",
    isKodyAssigned:
      data.assignees?.some(
        (a: any) =>
          a.login === "github-actions[bot]" ||
          a.login === "Copilot" ||
          (a as any).type === "Bot",
      ) ?? false,
  };

  if (!options?.noCache) {
    setCache(cacheKey, ttl, issue, { etag: newEtag });
  }
  return issue;
}

/**
 * Fetch issues with optional filters.
 *
 * Caching:
 * - Default TTL is `CACHE_TTL.tasks` (2min). Pass `ttl` to shorten it for
 *   endpoints that need fresher data (e.g. capabilities list).
 * - Post-TTL revalidation replays the cached ETag via `If-None-Match`. GitHub
 *   returns 304 (free, doesn't count against the rate limit) when the listing
 *   is unchanged, and the TTL is refreshed on the existing payload.
 * - `noCache` skips the cache entirely (rarely needed; prefer `ttl`).
 */
export async function fetchIssues(options?: {
  state?: "open" | "closed" | "all";
  labels?: string;
  excludeLabels?: string[];
  milestone?: number;
  perPage?: number;
  since?: string; // ISO 8601 date string - only returns issues updated after this date
  ttl?: number;
  noCache?: boolean;
}): Promise<GitHubIssue[]> {
  const { noCache, ttl: ttlOpt, ...rest } = options ?? {};
  const cacheKey = `issues:${getOwner()}:${getRepo()}:${JSON.stringify(rest)}`;
  const ttl = ttlOpt ?? CACHE_TTL.tasks;

  if (!noCache) {
    const cached = getCached<GitHubIssue[]>(cacheKey);
    if (cached) return cached;
  }

  const stale = noCache ? null : getStale<GitHubIssue[]>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.listForRepo({
      owner: getOwner(),
      repo: getRepo(),
      state: options?.state || "open",
      labels: options?.labels,
      milestone: options?.milestone ? String(options.milestone) : undefined,
      per_page: options?.perPage || 50,
      sort: "updated",
      direction: "desc",
      since: options?.since as any, // Octokit accepts ISO string
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (err: any) {
    // 304 Not Modified — reuse stale data, refresh TTL, no rate cost
    if (err.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    throw err;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const excludeSet = new Set(
    (options?.excludeLabels ?? []).map((l) => l.toLowerCase()),
  );

  // Filter out pull requests — GitHub issues API returns both issues and PRs
  // Also drop issues that carry any of the excluded labels (post-fetch because
  // the REST API's `labels` param only supports intersection, not negation).
  const issues: GitHubIssue[] = data
    .filter((issue: any) => !issue.pull_request)
    .filter((issue: any) => {
      if (excludeSet.size === 0) return true;
      const names: string[] = (issue.labels ?? []).map((l: any) =>
        (typeof l === "string" ? l : (l.name ?? "")).toLowerCase(),
      );
      return !names.some((n) => excludeSet.has(n));
    })
    .map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state as "open" | "closed",
      labels: issue.labels.map((l: any) =>
        typeof l === "string"
          ? { name: l, color: "000000" }
          : { name: l.name ?? "", color: l.color ?? "000000" },
      ),
      milestone: issue.milestone
        ? { title: issue.milestone.title ?? "" }
        : null,
      assignees:
        issue.assignees?.map((a: any) => ({
          login: a.login ?? "",
          avatar_url: a.avatar_url ?? "",
        })) ?? [],
      created_at: issue.created_at ?? "",
      updated_at: issue.updated_at ?? "",
      closed_at: issue.closed_at ?? null,
      html_url: issue.html_url ?? "",
      isKodyAssigned:
        issue.assignees?.some(
          (a: any) =>
            a.login === "github-actions[bot]" ||
            a.login === "Copilot" ||
            a.type === "Bot",
        ) ?? false,
    }));

  // Fallback: GitHub's REST `/repos/{owner}/{repo}/issues` listing has gone
  // wrong globally before (returns `[]` for repos with open issues). When the
  // REST listing is empty, retry once via GraphQL — which uses a separate
  // backend and stays up. We only do this on the empty path so genuinely
  // empty repos still take the cheap REST path.
  let finalIssues = issues;
  if (issues.length === 0) {
    try {
      const gql = await fetchIssuesViaGraphQL({
        state: options?.state ?? "open",
        labels: options?.labels,
        excludeLabels: options?.excludeLabels,
        perPage: options?.perPage ?? 50,
      });
      if (gql.length > 0) {
        finalIssues = gql;
      }
    } catch {
      // Fall through to the empty REST result; never let the fallback fail loud.
    }
  }

  if (!noCache) {
    // Only cache the ETag when the REST result was authoritative. The
    // GraphQL fallback path has no ETag, so we cache without one and let
    // the TTL drive the next refresh.
    if (finalIssues === issues) {
      setCache(cacheKey, ttl, finalIssues, { etag: newEtag });
    } else {
      setCache(cacheKey, ttl, finalIssues);
    }
  }
  return finalIssues;
}

interface GraphQLIssuesResponse {
  repository: {
    issues: {
      nodes: Array<{
        databaseId: number;
        number: number;
        title: string;
        body: string | null;
        state: "OPEN" | "CLOSED";
        url: string;
        createdAt: string;
        updatedAt: string;
        closedAt: string | null;
        labels: { nodes: Array<{ name: string; color: string }> };
        milestone: { title: string } | null;
        assignees: { nodes: Array<{ login: string; avatarUrl: string }> };
      }>;
    };
  };
}

/**
 * GraphQL fallback for fetchIssues. Used only when the REST listing is empty
 * — see comment in fetchIssues for why. Uses a separate GraphQL rate-limit
 * bucket. No ETag/304 (GraphQL doesn't expose them).
 */
async function fetchIssuesViaGraphQL(opts: {
  state: "open" | "closed" | "all";
  labels?: string;
  excludeLabels?: string[];
  perPage: number;
}): Promise<GitHubIssue[]> {
  const states =
    opts.state === "all"
      ? "[OPEN, CLOSED]"
      : opts.state === "closed"
        ? "[CLOSED]"
        : "[OPEN]";
  const first = Math.min(opts.perPage, 100);

  // GraphQL accepts a `labels: [String!]` filter on issues(). Mirror REST's
  // comma-separated `labels=a,b` semantics: results match all listed labels.
  const labelList = opts.labels
    ? opts.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const labelsArg = labelList.length
    ? `, labels: [${labelList.map((l) => JSON.stringify(l)).join(", ")}]`
    : "";

  const query = `
    query Issues($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        issues(first: ${first}, states: ${states}${labelsArg}, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            databaseId
            number
            title
            body
            state
            url
            createdAt
            updatedAt
            closedAt
            labels(first: 30) { nodes { name color } }
            milestone { title }
            assignees(first: 10) { nodes { login avatarUrl } }
          }
        }
      }
    }
  `;

  const octokit = getOctokit();
  const data = await octokit.graphql<GraphQLIssuesResponse>(query, {
    owner: getOwner(),
    repo: getRepo(),
  });

  const excludeSet = new Set(
    (opts.excludeLabels ?? []).map((l) => l.toLowerCase()),
  );

  return data.repository.issues.nodes
    .filter((node) => {
      if (excludeSet.size === 0) return true;
      const names = node.labels.nodes.map((l) => (l.name ?? "").toLowerCase());
      return !names.some((n) => excludeSet.has(n));
    })
    .map((node): GitHubIssue => {
      const assigneeLogins = node.assignees.nodes.map((a) => ({
        login: a.login ?? "",
        avatar_url: a.avatarUrl ?? "",
      }));
      return {
        id: node.databaseId,
        number: node.number,
        title: node.title,
        body: node.body ?? null,
        state: node.state.toLowerCase() as "open" | "closed",
        labels: node.labels.nodes.map((l) => ({
          name: l.name ?? "",
          color: l.color ?? "000000",
        })),
        milestone: node.milestone ? { title: node.milestone.title } : null,
        assignees: assigneeLogins,
        created_at: node.createdAt ?? "",
        updated_at: node.updatedAt ?? "",
        closed_at: node.closedAt,
        html_url: node.url ?? "",
        isKodyAssigned: assigneeLogins.some(
          (a) => a.login === "github-actions[bot]" || a.login === "Copilot",
        ),
      };
    });
}

/**
 * Fetch comments for an issue
 */
export async function fetchComments(
  issueNumber: number,
): Promise<GitHubComment[]> {
  const cacheKey = `comments:${getOwner()}:${getRepo()}:${issueNumber}`;
  const ttl = CACHE_TTL.tasks * 2;
  const cached = getCached<GitHubComment[]>(cacheKey);
  if (cached) return cached;

  // Stale-with-ETag path: post-TTL revalidation replays the cached ETag via
  // `If-None-Match`. GitHub returns 304 (free, no rate cost) when comments
  // haven't changed, and we refresh TTL on the existing payload. This was a
  // hot rate-limit drain when the fallback task lookup batched dozens of
  // comment fetches per request.
  const stale = getStale<GitHubComment[]>(cacheKey);
  const octokit = getOctokit();

  let response;
  try {
    response = await octokit.issues.listComments({
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      per_page: 100,
      headers: stale?.etag ? { "If-None-Match": stale.etag } : undefined,
    });
  } catch (err: any) {
    if (err.status === 304 && stale) {
      setCache(cacheKey, ttl, stale.data, { etag: stale.etag });
      return stale.data;
    }
    throw err;
  }

  const data = response.data;
  const newEtag = (response.headers as Record<string, string | undefined>)
    ?.etag;

  const comments: GitHubComment[] = data.map((comment: any) => ({
    id: comment.id,
    body: comment.body ?? "",
    created_at: comment.created_at ?? "",
    updated_at: comment.updated_at ?? comment.created_at ?? "",
    user: {
      login: comment.user?.login ?? "unknown",
      type: comment.user?.type ?? "User",
      avatar_url: comment.user?.avatar_url ?? "",
    },
  }));

  // Comments are less likely to change, cache longer
  setCache(cacheKey, ttl, comments, { etag: newEtag });
  return comments;
}

/**
 * Fetch the canonical kody TaskState for an issue. Returns null when the
 * engine has not written its state comment (legacy issues, non-kody issues,
 * or fetch errors — caller falls back to label/workflow-run derivation).
 *
 * Reuses fetchComments' ETag/304 cache, so polling cost is bounded: the first
 * call per issue costs one REST request; subsequent calls return 304 (free)
 * until the comment is edited.
 */
export async function fetchKodyState(
  issueNumber: number,
): Promise<import("../task-comment-state").KodyTaskState | null> {
  try {
    const { findKodyStateInComments } = await import("../task-comment-state");
    const comments = await fetchComments(issueNumber);
    return findKodyStateInComments(comments);
  } catch (err) {
    // Best effort — falling back to label/run derivation is acceptable.
    console.warn(`[fetchKodyState] failed for #${issueNumber}:`, err);
    return null;
  }
}

// ============ Labels & Milestones ============

/**
 * Fetch all labels
 */
export async function fetchLabels(): Promise<
  Array<{ name: string; color: string }>
> {
  const cacheKey = `labels:${getOwner()}:${getRepo()}`;
  const cached = getCached<Array<{ name: string; color: string }>>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  const { data } = await octokit.issues.listLabelsForRepo({
    owner: getOwner(),
    repo: getRepo(),
    per_page: 100,
  });

  const labels = data.map((label) => ({
    name: label.name,
    color: label.color,
  }));

  setCache(cacheKey, CACHE_TTL.boards, labels);
  return labels;
}

/**
 * Fetch all milestones
 */
export async function fetchMilestones(): Promise<
  Array<{ id: number; title: string; number: number }>
> {
  const cacheKey = `milestones:${getOwner()}:${getRepo()}`;
  const cached =
    getCached<Array<{ id: number; title: string; number: number }>>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  const { data } = await octokit.issues.listMilestones({
    owner: getOwner(),
    repo: getRepo(),
    state: "open",
    per_page: 50,
  });

  const milestones = data.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    number: milestone.number,
  }));

  setCache(cacheKey, CACHE_TTL.boards, milestones);
  return milestones;
}

// ============ Actions ============

/**
 * Post a comment on an issue
 */
export async function postComment(
  issueNumber: number,
  body: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.createComment({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    body,
  });

  // Invalidate both comment caches — issue conversation and PR conversation
  // share GitHub's issue-comments endpoint, but the dashboard caches them
  // under separate keys (`comments:` for the issue panel, `pr-comments:` for
  // PreviewModal). Clear both so neither view shows stale data.
  cache.delete(`comments:${getOwner()}:${getRepo()}:${issueNumber}`);
  cache.delete(`pr-comments:${getOwner()}:${getRepo()}:${issueNumber}`);
}

/**
 * Trigger workflow dispatch
 */
// ============ Issue CRUD Operations ============

/**
 * Create a new GitHub issue
 */
export async function createIssue(
  options: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  },
  userOctokit?: Octokit,
): Promise<GitHubIssue> {
  const octokit = userOctokit ?? getOctokit();

  const { data } = await createIssueWithBestEffortMetadata(octokit, {
    owner: getOwner(),
    repo: getRepo(),
    title: options.title,
    body: options.body ?? "",
    labels: options.labels,
    assignees: options.assignees,
  });

  // Invalidate task-related caches only (not PRs, boards, etc.)
  invalidateTaskCache();

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state as "open" | "closed",
    labels:
      data.labels?.map((l: any) => ({
        name: l.name ?? "",
        color: l.color ?? "000000",
      })) ?? [],
    milestone: data.milestone ? { title: data.milestone.title ?? "" } : null,
    assignees:
      data.assignees?.map((a: any) => ({
        login: a.login ?? "",
        avatar_url: a.avatar_url ?? "",
      })) ?? [],
    created_at: data.created_at ?? "",
    updated_at: data.updated_at ?? "",
    closed_at: data.closed_at ?? null,
    html_url: data.html_url ?? "",
  };
}

/**
 * Upload an attachment to an issue (requires GitHub Enterprise)
 */
export async function uploadIssueAttachment(
  issueNumber: number,
  file: { name: string; content: string },
  userOctokit?: Octokit,
): Promise<{ attachment_url: string; name: string }> {
  const octokit = (userOctokit ?? getOctokit()) as any;

  const buffer = Buffer.from(file.content, "base64");

  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/attachments",
    {
      owner: getOwner(),
      repo: getRepo(),
      issue_number: issueNumber,
      name: file.name,
      file: buffer,
    },
  );

  return {
    attachment_url: response.data.asset_url,
    name: response.data.name,
  };
}

/**
 * Store a comment attachment in the tenant backend and return a Dashboard URL.
 * The download route enforces the same repository authentication as the rest
 * of the Dashboard, so private attachments never become public blobs.
 */
export async function uploadCommentAttachment(
  file: { name: string; contentBase64: string },
  _userOctokit?: Octokit,
  origin = "",
): Promise<{
  url: string;
  path: string;
  name: string;
  isImage: boolean;
  markdown: string;
}> {
  const owner = getOwner();
  const repo = getRepo();

  const cleaned = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
  const safeName = cleaned.replace(/^[-.]+/, "") || "file";
  const id = globalThis.crypto.randomUUID();
  const path = `attachment:${id}`;
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(safeName);
  await createBackendClient().mutation(backendApi.repoDocs.save, {
    tenantId: `${owner}/${repo}`,
    kind: path,
    doc: {
      name: safeName,
      contentBase64: file.contentBase64,
      isImage,
    },
    updatedAt: new Date().toISOString(),
  });

  const query = new URLSearchParams({ owner, repo }).toString();
  const url = `${origin.replace(/\/+$/, "")}/api/kody/attachments/${id}?${query}`;
  const markdown = isImage
    ? `![${safeName}](${url})`
    : `[📎 ${safeName}](${url})`;

  return {
    path,
    url,
    name: safeName,
    isImage,
    markdown,
  };
}

/**
 * Update an issue (close, reopen, change title/body)
 */
export async function updateIssue(
  issueNumber: number,
  options: {
    title?: string;
    body?: string;
    state?: "open" | "closed";
    labels?: string[];
    assignees?: string[];
  },
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.update({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    title: options.title,
    body: options.body,
    state: options.state,
    labels: options.labels,
    assignees: options.assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
  cache.delete(`comments:${getOwner()}:${getRepo()}:${issueNumber}`);
}

/**
 * Add assignees to an issue
 */
export async function addAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.addAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Remove assignees from an issue
 */
export async function removeAssignees(
  issueNumber: number,
  assignees: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.removeAssignees({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    assignees,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Add labels to an issue
 */
export async function addLabels(
  issueNumber: number,
  labels: string[],
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.addLabels({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    labels,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Create a repo label if it does not already exist. Idempotent — a 422 from
 * GitHub ("already_exists") is treated as success. GitHub's addLabels endpoint
 * does NOT auto-create labels, so callers that attach ad-hoc labels (e.g.
 * dashboard-owned labels should ensure the label first.
 */
export async function ensureLabel(
  name: string,
  options: { color?: string; description?: string } = {},
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();
  try {
    await octokit.issues.createLabel({
      owner: getOwner(),
      repo: getRepo(),
      name,
      color: (options.color ?? "cccccc").replace(/^#/, ""),
      description: options.description,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status !== 422) throw err;
  }
}

/**
 * Remove a label from an issue
 */
export async function removeLabel(
  issueNumber: number,
  label: string,
  userOctokit?: Octokit,
): Promise<void> {
  const octokit = userOctokit ?? getOctokit();

  await octokit.issues.removeLabel({
    owner: getOwner(),
    repo: getRepo(),
    issue_number: issueNumber,
    name: label,
  });

  // Invalidate task cache
  invalidateTaskCache();
}

/**
 * Fetch repository collaborators (for assignee picker).
 * Returns [] if the token lacks permission to list collaborators (e.g., private repo
 * where user is not an explicit collaborator, or insufficient scopes).
 */
export async function fetchCollaborators(): Promise<GitHubCollaborator[]> {
  const cacheKey = `collaborators:${getOwner()}:${getRepo()}`;
  const cached = getCached<GitHubCollaborator[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();

  try {
    const { data } = await octokit.repos.listCollaborators({
      owner: getOwner(),
      repo: getRepo(),
      per_page: 100,
    });

    const collaborators: GitHubCollaborator[] = data.map((user) => ({
      login: user.login ?? "",
      avatar_url: user.avatar_url ?? "",
    }));

    setCache(cacheKey, CACHE_TTL.boards, collaborators);
    return collaborators;
  } catch (error: unknown) {
    // Permission denied (403) or not found (404) — user is not a collaborator or token lacks scope
    const status = (error as { status?: number })?.status;
    if (status === 403 || status === 404) {
      console.warn(
        `[Kody] Cannot list collaborators (${status}), returning empty list`,
      );
      return [];
    }
    throw error;
  }
}
