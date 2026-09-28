/**
 * @fileType utility
 * @domain kody
 * @pattern github-client
 * @ai-summary GitHub branch discovery, deletion and task/branch document reads.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from "@octokit/rest";
import {
  BRANCH_PREFIXES,
  BRANCH_CACHE_TTL,
  TASK_ID_REGEX,
} from "@kody-ade/base/constants";
import { isProtectedBranch } from "../branches";
import type { TaskDocument } from "@kody-ade/base/types";
import {
  getCached,
  setCache,
  getOctokit,
  getOwner,
  getRepo,
  invalidateBranchCache,
  invalidateTaskCache,
} from "@kody-ade/base/github/core";
// ============ Branch Discovery ============

/**
 * Load (and cache) the full list of branches under a prefix. Cached for
 * BRANCH_CACHE_TTL so subsequent lookups hit memory, not the GitHub API.
 * Shared by findTaskBranch and findBranchesByIssueNumbers.
 */
async function getBranchesForPrefix(prefix: string): Promise<string[]> {
  const cacheKey = `branches:${getOwner()}:${getRepo()}:prefix:${prefix}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();
  try {
    const { data } = await octokit.git.listMatchingRefs({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${prefix}/`,
    });
    const branches = data.map((ref: any) => ref.ref.replace("refs/heads/", ""));
    setCache(cacheKey, BRANCH_CACHE_TTL, branches);
    return branches;
  } catch {
    return [];
  }
}

/**
 * Find the branch for a task across all known prefixes.
 * Uses cached per-prefix listings — on a warm cache this makes zero API calls.
 */
export async function findTaskBranch(taskId: string): Promise<string | null> {
  if (!TASK_ID_REGEX.test(taskId)) {
    return null;
  }

  const cacheKey = `branch:${getOwner()}:${getRepo()}:task:${taskId}`;
  const cached = getCached<string | null>(cacheKey);
  if (cached !== null) return cached;

  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);
      const exact = `${prefix}/${taskId}`;
      const withSuffix = `${prefix}/${taskId}-`;
      return (
        branches.find((b) => b === exact || b.startsWith(withSuffix)) ?? null
      );
    }),
  );

  const found = results.find((r) => r !== null) ?? null;
  setCache(cacheKey, BRANCH_CACHE_TTL, found);
  return found;
}

/**
 * Find a branch by issue number.
 * The pipeline convention includes the issue number in the branch name:
 *   {prefix}/{YYMMDD}-auto-{issueNumber}-{sanitized-title}
 * We search across all known prefixes using the matching-refs API.
 */
export async function findBranchByIssueNumber(
  issueNumber: string | number,
): Promise<string | null> {
  const cacheKey = `branch:${getOwner()}:${getRepo()}:issue:${issueNumber}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  const issueStr = String(issueNumber);
  const pattern = new RegExp(`-${issueStr}-`);

  // Reuse the shared prefix-branch cache
  const results = await Promise.all(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);
      return branches.find((b) => pattern.test(b)) ?? null;
    }),
  );

  const found = results.find((r) => r !== null) ?? null;
  if (found) setCache(cacheKey, BRANCH_CACHE_TTL, found);
  return found;
}

/**
 * Fetch branches for multiple issue numbers in a single batch.
 * Makes 5 listMatchingRefs calls (one per prefix) instead of 5*N calls.
 * Returns a map of issueNumber -> branchName.
 *
 * Also caches the full branch list per prefix to avoid redundant calls on subsequent polls.
 */
export async function findBranchesByIssueNumbers(
  issueNumbers: (string | number)[],
): Promise<Map<number, string>> {
  if (issueNumbers.length === 0) return new Map();

  const result = new Map<number, string>();
  const issueStrs = issueNumbers.map((n) => String(n));

  // Fetch (or hit cache for) each prefix's branch list in parallel
  void (await Promise.allSettled(
    BRANCH_PREFIXES.map(async (prefix) => {
      const branches = await getBranchesForPrefix(prefix);

      for (const issueStr of issueStrs) {
        const pattern = new RegExp(`-${issueStr}-`);
        const match = branches.find((branchName) => pattern.test(branchName));
        if (match) {
          const issueNum = parseInt(issueStr, 10);
          if (!result.has(issueNum)) {
            result.set(issueNum, match);
            const individualCacheKey = `branch:issue:${issueStr}`;
            setCache(individualCacheKey, BRANCH_CACHE_TTL, match);
          }
        }
      }
    }),
  ));

  return result;
}

export async function deleteBranch(
  branchName: string,
  userOctokit?: Octokit,
): Promise<void> {
  // Don't delete protected branches (single source of truth in
  // src/dashboard/lib/branches/protected-branches.ts)
  if (isProtectedBranch(branchName)) {
    console.log(`[Kody] Skipping deletion of protected branch: ${branchName}`);
    return;
  }

  const octokit = userOctokit ?? getOctokit();

  try {
    await octokit.git.deleteRef({
      owner: getOwner(),
      repo: getRepo(),
      ref: `heads/${branchName}`,
    });
    console.log(`[Kody] Deleted branch: ${branchName}`);
  } catch (error: any) {
    // Ignore if branch doesn't exist
    if (
      error.status === 422 &&
      error.message?.includes("Reference does not exist")
    ) {
      console.log(`[Kody] Branch already deleted: ${branchName}`);
      return;
    }
    throw error;
  }

  // Invalidate branch and task caches
  invalidateBranchCache();
  invalidateTaskCache();
}

/**
 * Fetch all task documents from branch by listing the task directory.
 * Discovers files dynamically instead of using a hardcoded list.
 */
export async function fetchTaskDocuments(
  taskId: string,
  branch: string,
): Promise<TaskDocument[]> {
  const octokit = getOctokit();
  const taskPath = `.tasks/${taskId}`;

  try {
    // List all files in the task directory
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: taskPath,
      ref: branch,
    });

    if (!Array.isArray(data)) return [];

    // Filter to files only (skip subdirectories), fetch content in parallel
    const files = data.filter((item: any) => item.type === "file");

    const results = await Promise.allSettled(
      files.map(async (file: any) => {
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: getOwner(),
            repo: getRepo(),
            path: file.path,
            ref: branch,
          });

          if ("content" in fileData && fileData.content) {
            const content = Buffer.from(fileData.content, "base64").toString(
              "utf-8",
            );
            return {
              name: file.name as string,
              content,
              path: file.path as string,
            };
          }
        } catch {
          // File content couldn't be fetched
        }
        return null;
      }),
    );

    const documents: TaskDocument[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        documents.push(result.value);
      }
    }

    return documents;
  } catch {
    // Task directory doesn't exist on this branch
    return [];
  }
}

/**
 * Fetch task documents by discovering the task directory on a branch.
 * Lists .tasks/ dir, finds dirs matching YYMMDD- pattern, picks the newest,
 * then fetches known doc files from it.
 */
export async function fetchBranchDocuments(
  branch: string,
): Promise<TaskDocument[]> {
  const octokit = getOctokit();

  try {
    // 1. List .tasks/ directory on the branch
    const { data } = await octokit.repos.getContent({
      owner: getOwner(),
      repo: getRepo(),
      path: ".tasks",
      ref: branch,
    });

    if (!Array.isArray(data)) return [];

    // 2. Find directories matching YYMMDD- pattern (e.g., 260228-auto-74)
    const taskDirs = data
      .filter((item: any) => item.type === "dir" && /^\d{6}-/.test(item.name))
      .map((item: any) => item.name)
      .sort()
      .reverse(); // newest first by date prefix

    if (taskDirs.length === 0) return [];

    // 3. Use the newest task dir
    const taskId = taskDirs[0];

    // 4. Fetch known doc files from it
    return fetchTaskDocuments(taskId, branch);
  } catch (error: any) {
    if (error.status !== 404) {
      console.error("[Kody] Error listing branch task dirs:", error);
    }
    return [];
  }
}

