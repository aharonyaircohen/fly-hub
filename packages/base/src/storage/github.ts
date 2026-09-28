import type { Octokit } from "@octokit/rest";

import { writeGitHubFileWithRetry } from "@kody-ade/base/github-contents-write";
import {
  commitGitHubTreeMutation,
  type GitHubTreeChange,
} from "@kody-ade/base/github-tree-commit";
import type {
  StorageAdapter,
  StorageEntry,
  StorageFile,
  StorageFileMetadata,
} from "./types";

export interface GitHubStorageTarget {
  owner: string;
  repo: string;
  ref?: string;
}

interface GitHubContentResponse {
  data: unknown;
  headers?: unknown;
}

interface GitHubStorageClient {
  repos: {
    getContent(params: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
      headers?: Record<string, string>;
    }): Promise<GitHubContentResponse>;
  };
}

interface ContentFile {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  html_url?: string;
  size?: number;
}

interface ContentEntry {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  html_url?: string;
}

export function createGitHubStorageAdapter(
  client: GitHubStorageClient,
): StorageAdapter<GitHubStorageTarget> {
  return {
    name: "github",

    async readText(target, path, options = {}) {
      try {
        const res = await client.repos.getContent(
          contentParams(target, path, options.headers),
        );
        const data = res.data as ContentFile | ContentFile[];
        if (
          Array.isArray(data) ||
          (data.type && data.type !== "file") ||
          !data.content
        ) {
          return null;
        }
        return normalizeFile(path, data, res.headers);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },

    async readMetadata(target, path) {
      try {
        const res = await client.repos.getContent(contentParams(target, path));
        const data = res.data as ContentFile | ContentFile[];
        if (
          Array.isArray(data) ||
          (data.type && data.type !== "file") ||
          !data.sha
        ) {
          return null;
        }
        return normalizeMetadata(path, data);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },

    async list(target, path, options = {}) {
      try {
        const res = await client.repos.getContent(
          contentParams(target, path, options.headers),
        );
        const data = res.data as ContentEntry | ContentEntry[];
        return {
          path,
          entries: Array.isArray(data) ? normalizeEntries(data) : [],
          etag: (res.headers as Record<string, string | undefined>)?.etag,
        };
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          return { path, entries: [] };
        }
        throw err;
      }
    },

    async writeText(options) {
      return this.writeBase64({
        ...options,
        contentBase64: Buffer.from(options.content, "utf8").toString("base64"),
      });
    },

    async writeBase64(options) {
      const octokit = requireWritableGitHubClient(client);
      await ensureGitHubRef(octokit, options.target);
      const res = await writeGitHubFileWithRetry(octokit, {
        owner: options.target.owner,
        repo: options.target.repo,
        path: options.path,
        branch: options.target.ref,
        message: options.message,
        content: options.contentBase64,
        ...(options.version ? { sha: options.version } : {}),
        ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
      });
      return {
        path: options.path,
        version: res.sha,
        url: res.htmlUrl,
      };
    },

    async writeTextFiles(options) {
      if (options.files.length === 0) {
        throw new Error("No storage files to write");
      }
      const octokit = requireWritableGitHubClient(client);
      await ensureGitHubRef(octokit, options.target);
      const commitSha = await commitTree(octokit, options.target, {
        message: options.message,
        tree: options.files.map((file) => ({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          content: file.content,
        })),
      });
      return { version: commitSha };
    },

    async writeBase64Files(options) {
      if (options.files.length === 0) {
        throw new Error("No storage files to write");
      }
      const octokit = requireWritableGitHubClient(client);
      await ensureGitHubRef(octokit, options.target);
      const blobs = await Promise.all(
        options.files.map(async (file) => {
          const blob = await octokit.git.createBlob({
            owner: options.target.owner,
            repo: options.target.repo,
            content: file.contentBase64,
            encoding: "base64",
          });
          return { path: file.path, sha: blob.data.sha };
        }),
      );
      const commitSha = await commitTree(octokit, options.target, {
        message: options.message,
        tree: blobs.map((blob) => ({
          path: blob.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        })),
      });
      return { version: commitSha };
    },

    async deleteFile(options) {
      const octokit = requireWritableGitHubClient(client);
      await ensureGitHubRef(octokit, options.target);
      await octokit.repos.deleteFile({
        owner: options.target.owner,
        repo: options.target.repo,
        path: options.path,
        branch: options.target.ref,
        message: options.message,
        sha: options.version,
      });
    },

    async deleteDirectory(options) {
      const octokit = requireWritableGitHubClient(client);
      await ensureGitHubRef(octokit, options.target);
      const prefix = `${options.path.replace(/\/+$/g, "")}/`;
      if (!options.target.ref) {
        throw new Error("GitHub storage target ref is required");
      }
      const readDeletions = async (
        treeSha: string,
      ): Promise<GitHubTreeChange[]> => {
        const currentTree = await octokit.git.getTree({
          owner: options.target.owner,
          repo: options.target.repo,
          tree_sha: treeSha,
          recursive: "true",
        });
        if (currentTree.data.truncated) {
          throw new Error("Storage tree is too large to delete safely");
        }
        return currentTree.data.tree
          .filter(
            (
              entry,
            ): entry is typeof entry & {
              path: string;
              mode: "100644" | "100755" | "120000";
              type: "blob";
            } =>
              entry.type === "blob" &&
              typeof entry.path === "string" &&
              ["100644", "100755", "120000"].includes(entry.mode ?? "") &&
              entry.path.startsWith(prefix),
          )
          .map<GitHubTreeChange>((entry) => ({
            path: entry.path,
            mode: entry.mode,
            type: entry.type,
            sha: null,
          }));
      };
      const base = await getBaseCommit(octokit, options.target);
      const initialDeletions = await readDeletions(base.treeSha);
      if (initialDeletions.length === 0) return { deleted: 0 };

      let deleted = initialDeletions.length;
      await commitGitHubTreeMutation(
        octokit,
        {
          owner: options.target.owner,
          repo: options.target.repo,
          ref: options.target.ref,
        },
        {
          message: options.message,
          buildChanges: async ({ treeSha }) => {
            const deletions = await readDeletions(treeSha);
            deleted = deletions.length;
            return deletions;
          },
        },
      );
      return { deleted };
    },
  };
}

export function createGitHubStorageFetchClient(
  fetchImpl: typeof fetch = fetch,
): GitHubStorageClient {
  return {
    repos: {
      async getContent({ owner, repo, path, ref, headers }) {
        const url = githubContentsUrl(owner, repo, path);
        if (ref) url.searchParams.set("ref", ref);
        const res = await fetchImpl(url.toString(), {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "kody-dashboard",
            ...headers,
          },
        });
        if (!res.ok) {
          throw Object.assign(new Error("github_contents_read_failed"), {
            status: res.status,
          });
        }
        return {
          data: await res.json(),
          headers: responseHeadersToRecord(res.headers),
        };
      },
    },
  };
}

function contentParams(
  target: GitHubStorageTarget,
  path: string,
  headers?: Record<string, string>,
): {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  headers?: Record<string, string>;
} {
  return {
    owner: target.owner,
    repo: target.repo,
    path,
    ...(target.ref ? { ref: target.ref } : {}),
    ...(headers ? { headers } : {}),
  };
}

function githubContentsUrl(owner: string, repo: string, path: string): URL {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
  );
}

function responseHeadersToRecord(
  headers: Headers | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  headers?.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function requireWritableGitHubClient(client: GitHubStorageClient): Octokit {
  return client as unknown as Octokit;
}

function normalizeFile(
  path: string,
  data: ContentFile,
  headers: unknown,
): StorageFile {
  return {
    path,
    content: Buffer.from(
      data.content ?? "",
      (data.encoding ?? "base64") as BufferEncoding,
    ).toString("utf8"),
    version: data.sha ?? "",
    etag: (headers as Record<string, string | undefined>)?.etag,
    url: data.html_url,
    size: data.size,
  };
}

function normalizeMetadata(
  path: string,
  data: ContentFile,
): StorageFileMetadata {
  return {
    path,
    version: data.sha ?? "",
    url: data.html_url,
    size: data.size,
  };
}

function normalizeEntries(data: ContentEntry[]): StorageEntry[] {
  return data
    .filter(
      (
        entry,
      ): entry is ContentEntry & {
        name: string;
        path: string;
        type: string;
      } =>
        typeof entry.name === "string" &&
        typeof entry.path === "string" &&
        typeof entry.type === "string",
    )
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      url: entry.html_url,
    }));
}

async function getBaseCommit(
  octokit: Octokit,
  target: GitHubStorageTarget,
): Promise<{ headSha: string; treeSha: string }> {
  const ref = await octokit.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${target.ref}`,
  });
  const headSha = ref.data.object.sha;
  const baseCommit = await octokit.git.getCommit({
    owner: target.owner,
    repo: target.repo,
    commit_sha: headSha,
  });
  return {
    headSha,
    treeSha: baseCommit.data.tree.sha,
  };
}

async function ensureGitHubRef(
  octokit: Octokit,
  target: GitHubStorageTarget,
): Promise<void> {
  try {
    await octokit.git.getRef({
      owner: target.owner,
      repo: target.repo,
      ref: `heads/${target.ref}`,
    });
    return;
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  const repoInfo = await octokit.repos.get({
    owner: target.owner,
    repo: target.repo,
  });
  const defaultBranch = repoInfo.data.default_branch;
  const defaultRef = await octokit.git.getRef({
    owner: target.owner,
    repo: target.repo,
    ref: `heads/${defaultBranch}`,
  });

  try {
    await octokit.git.createRef({
      owner: target.owner,
      repo: target.repo,
      ref: `refs/heads/${target.ref}`,
      sha: defaultRef.data.object.sha,
    });
  } catch (err) {
    if ((err as { status?: number }).status !== 422) throw err;
  }
}

async function commitTree(
  octokit: Octokit,
  target: GitHubStorageTarget,
  options: {
    message: string;
    tree: GitHubTreeChange[];
  },
): Promise<string> {
  if (!target.ref) throw new Error("GitHub storage target ref is required");
  const result = await commitGitHubTreeMutation(
    octokit,
    { owner: target.owner, repo: target.repo, ref: target.ref },
    {
      message: options.message,
      buildChanges: () => options.tree,
    },
  );
  return result.commitSha;
}
