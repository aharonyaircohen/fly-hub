import type { Octokit } from "@octokit/rest";
import {
  commitGitHubTreeMutation,
  type GitHubTreeChange,
  type GitHubTreeMode,
  type GitHubTreeObjectType,
} from "@kody-ade/base/github-tree-commit";

import {
  normalizeRepoPath,
  replacePathPrefix,
  type RepoPathType,
} from "./file-paths";

export interface RepositoryObjectEntry {
  path: string;
  sha: string;
  mode: GitHubTreeMode;
  type: GitHubTreeObjectType;
}

export type RepositoryPathMutation =
  | {
      operation: "move" | "duplicate";
      sourcePath: string;
      sourceType: RepoPathType;
      targetPath: string;
    }
  | {
      operation: "delete";
      sourcePath: string;
      sourceType: RepoPathType;
    };

export interface RepositoryPathMutationResult {
  commitSha: string;
}

class RepositoryPathNotVisibleError extends Error {
  constructor(operation: RepositoryPathMutation["operation"], path: string) {
    super(`Nothing to ${operation} at ${path}`);
    this.name = "RepositoryPathNotVisibleError";
  }
}

const SOURCE_VISIBILITY_ATTEMPTS = 3;
const SOURCE_VISIBILITY_RETRY_MS = 250;

function isObjectEntry(
  entry: Readonly<{
    path?: string;
    sha?: string | null;
    mode?: string;
    type?: string;
  }>,
): entry is RepositoryObjectEntry {
  return (
    typeof entry.path === "string" &&
    typeof entry.sha === "string" &&
    ["100644", "100755", "040000", "120000", "160000"].includes(
      entry.mode ?? "",
    ) &&
    ["blob", "tree", "commit"].includes(entry.type ?? "")
  );
}

function isSourceEntry(
  path: string,
  sourcePath: string,
  sourceType: RepoPathType,
): boolean {
  return (
    path === sourcePath ||
    (sourceType === "dir" && path.startsWith(`${sourcePath}/`))
  );
}

function assertValidDestination(
  entries: RepositoryObjectEntry[],
  mutation: Exclude<RepositoryPathMutation, { operation: "delete" }>,
): void {
  if (
    mutation.sourceType === "dir" &&
    mutation.targetPath.startsWith(`${mutation.sourcePath}/`)
  ) {
    throw new Error("A folder cannot be moved inside itself");
  }

  for (const entry of entries) {
    const belongsToMovingSource =
      mutation.operation === "move" &&
      isSourceEntry(entry.path, mutation.sourcePath, mutation.sourceType);
    if (belongsToMovingSource) continue;

    if (
      entry.path === mutation.targetPath ||
      (mutation.sourceType === "dir" &&
        entry.path.startsWith(`${mutation.targetPath}/`))
    ) {
      throw new Error(
        `A file or folder already exists at ${mutation.targetPath}`,
      );
    }

    if (
      mutation.targetPath.startsWith(`${entry.path}/`) &&
      entry.type !== "tree"
    ) {
      throw new Error(`Destination parent is not a folder: ${entry.path}`);
    }
  }
}

export function buildRepositoryPathChanges(
  entries: RepositoryObjectEntry[],
  input: RepositoryPathMutation,
): GitHubTreeChange[] {
  const mutation = {
    ...input,
    sourcePath: normalizeRepoPath(input.sourcePath),
    ...("targetPath" in input
      ? { targetPath: normalizeRepoPath(input.targetPath) }
      : {}),
  } as RepositoryPathMutation;
  const sourceEntries = entries.filter(
    (entry) =>
      entry.type !== "tree" &&
      isSourceEntry(entry.path, mutation.sourcePath, mutation.sourceType),
  );
  if (sourceEntries.length === 0) {
    throw new RepositoryPathNotVisibleError(
      mutation.operation,
      mutation.sourcePath,
    );
  }

  if (mutation.operation === "delete") {
    return sourceEntries.map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: null,
    }));
  }

  assertValidDestination(entries, mutation);
  const writes = sourceEntries.map<GitHubTreeChange>((entry) => ({
    path:
      mutation.sourceType === "dir"
        ? replacePathPrefix(
            entry.path,
            mutation.sourcePath,
            mutation.targetPath,
          )
        : mutation.targetPath,
    mode: entry.mode,
    type: entry.type,
    sha: entry.sha,
  }));
  if (mutation.operation === "duplicate") return writes;

  return [
    ...writes,
    ...sourceEntries.map<GitHubTreeChange>((entry) => ({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: null,
    })),
  ];
}

async function resolveDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  const repository = await octokit.repos.get({ owner, repo });
  return repository.data.default_branch;
}

async function readRepositoryObjects(
  octokit: Octokit,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<RepositoryObjectEntry[]> {
  const tree = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "true",
  });
  if (tree.data.truncated) {
    throw new Error("Repository tree is too large to change safely");
  }
  return tree.data.tree.filter(isObjectEntry);
}

async function mutateRepositoryPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutation: RepositoryPathMutation,
  message: string,
): Promise<RepositoryPathMutationResult> {
  const ref = await resolveDefaultBranch(octokit, owner, repo);
  for (
    let attempt = 1;
    attempt <= SOURCE_VISIBILITY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const result = await commitGitHubTreeMutation(
        octokit,
        { owner, repo, ref },
        {
          message,
          buildChanges: async ({ treeSha }) =>
            buildRepositoryPathChanges(
              await readRepositoryObjects(octokit, owner, repo, treeSha),
              mutation,
            ),
        },
      );
      return { commitSha: result.commitSha };
    } catch (error) {
      if (
        !(error instanceof RepositoryPathNotVisibleError) ||
        attempt === SOURCE_VISIBILITY_ATTEMPTS
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SOURCE_VISIBILITY_RETRY_MS * attempt),
      );
    }
  }

  throw new Error("Repository path visibility retry exhausted");
}

export async function deleteRepositoryPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  pathType: RepoPathType,
): Promise<void> {
  const sourcePath = normalizeRepoPath(path);
  await mutateRepositoryPath(
    octokit,
    owner,
    repo,
    { operation: "delete", sourcePath, sourceType: pathType },
    `chore: delete ${sourcePath}`,
  );
}

export async function moveRepositoryPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  source: string,
  pathType: RepoPathType,
  target: string,
): Promise<RepositoryPathMutationResult> {
  const sourcePath = normalizeRepoPath(source);
  const targetPath = normalizeRepoPath(target);
  return mutateRepositoryPath(
    octokit,
    owner,
    repo,
    {
      operation: "move",
      sourcePath,
      sourceType: pathType,
      targetPath,
    },
    `chore: move ${sourcePath} to ${targetPath}`,
  );
}

export async function duplicateRepositoryPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  source: string,
  pathType: RepoPathType,
  target: string,
): Promise<RepositoryPathMutationResult> {
  const sourcePath = normalizeRepoPath(source);
  const targetPath = normalizeRepoPath(target);
  return mutateRepositoryPath(
    octokit,
    owner,
    repo,
    {
      operation: "duplicate",
      sourcePath,
      sourceType: pathType,
      targetPath,
    },
    `chore: duplicate ${sourcePath} to ${targetPath}`,
  );
}
