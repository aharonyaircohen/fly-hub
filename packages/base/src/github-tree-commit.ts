import type { Octokit } from "@octokit/rest";

export type GitHubTreeMode =
  "100644" | "100755" | "040000" | "160000" | "120000";

export type GitHubTreeObjectType = "blob" | "tree" | "commit";

export type GitHubTreeChange =
  | {
      path: string;
      mode: GitHubTreeMode;
      type: GitHubTreeObjectType;
      sha: string | null;
    }
  | {
      path: string;
      mode: "100644" | "100755";
      type: "blob";
      content: string;
    };

export interface GitHubCommitBase {
  headSha: string;
  treeSha: string;
}

export interface GitHubTreeTarget {
  owner: string;
  repo: string;
  ref: string;
}

export interface GitHubTreeCommitResult {
  commitSha: string;
  treeSha: string;
}

interface GitHubTreeMutationOptions {
  message: string;
  buildChanges(
    base: GitHubCommitBase,
  ): Promise<GitHubTreeChange[]> | GitHubTreeChange[];
  maxAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_TREE_ENTRIES = 100_000;
const MAX_TREE_BODY_BYTES = 7 * 1024 * 1024;

function normalizeBranchRef(ref: string): string {
  return ref.replace(/^refs\/heads\/|^heads\//, "");
}

function isRetryableTreeRace(error: unknown): boolean {
  const candidate = error as { status?: number; message?: string };
  return (
    candidate.status === 422 &&
    /not a fast forward|non-fast-forward|GitRPC::BadObjectState/i.test(
      candidate.message ?? "",
    )
  );
}

function validateChanges(changes: GitHubTreeChange[]): void {
  if (changes.length === 0) {
    throw new Error("At least one Git tree change is required");
  }
  if (changes.length > MAX_TREE_ENTRIES) {
    throw new Error(
      `Git tree mutation exceeds ${MAX_TREE_ENTRIES.toLocaleString()} entries`,
    );
  }

  const paths = new Set<string>();
  for (const change of changes) {
    if (paths.has(change.path)) {
      throw new Error(`Duplicate Git tree path: ${change.path}`);
    }
    paths.add(change.path);
  }

  const bodyBytes = new TextEncoder().encode(
    JSON.stringify({ tree: changes }),
  ).byteLength;
  if (bodyBytes > MAX_TREE_BODY_BYTES) {
    throw new Error("Git tree mutation exceeds GitHub's 7 MB request limit");
  }
}

async function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function commitGitHubTreeMutation(
  octokit: Octokit,
  target: GitHubTreeTarget,
  options: GitHubTreeMutationOptions,
): Promise<GitHubTreeCommitResult> {
  const branch = normalizeBranchRef(target.ref);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const currentRef = await octokit.git.getRef({
        owner: target.owner,
        repo: target.repo,
        ref: `heads/${branch}`,
        // Git refs are mutable. A unique query value prevents browser HTTP
        // caches from serving the branch head used by a previous mutation.
        cache_bust: Date.now(),
      });
      const headSha = currentRef.data.object.sha;
      const currentCommit = await octokit.git.getCommit({
        owner: target.owner,
        repo: target.repo,
        commit_sha: headSha,
      });
      const treeSha = currentCommit.data.tree.sha;
      const changes = await options.buildChanges({ headSha, treeSha });
      validateChanges(changes);

      const nextTree = await octokit.git.createTree({
        owner: target.owner,
        repo: target.repo,
        base_tree: treeSha,
        tree: changes,
      });
      const nextCommit = await octokit.git.createCommit({
        owner: target.owner,
        repo: target.repo,
        message: options.message,
        tree: nextTree.data.sha,
        parents: [headSha],
      });
      await octokit.git.updateRef({
        owner: target.owner,
        repo: target.repo,
        ref: `heads/${branch}`,
        sha: nextCommit.data.sha,
        force: false,
      });

      return {
        commitSha: nextCommit.data.sha,
        treeSha: nextTree.data.sha,
      };
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableTreeRace(error)) {
        throw error;
      }
      await wait(retryDelayMs * attempt);
    }
  }

  throw new Error("Git tree mutation retry exhausted");
}
