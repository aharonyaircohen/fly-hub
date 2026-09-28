/**
 * @fileType utility
 * @domain files
 * @pattern repo-files
 * @ai-summary GitHub Contents API wrapper for the /files page. Provides
 *   listDir, readFile, writeFile, deleteFile, createSymlink,
 *   uploadFile, searchCode, and commitsForPath — all using the user's
 *   token so permissions match their GitHub access.
 */
"use client";

import type { Octokit } from "@octokit/rest";
import { writeGitHubFileWithRetry } from "@kody-ade/base/github-contents-write";
import {
  base64ToBytes,
  bytesToBase64,
  isBinaryBytes,
  stringToBase64,
} from "./file-content";

export {
  base64ToBytes,
  base64ToString,
  isBinaryBytes,
  stringToBase64,
} from "./file-content";

/** Compute line number (1-indexed) in a fragment given a byte offset to the match. */
export function lineIndexFromFragment(
  fragment: string,
  matchByteIndex: number,
): number {
  return (fragment.slice(0, matchByteIndex).match(/\n/g)?.length ?? 0) + 1;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const value = error as {
    status?: number;
    response?: { status?: number; statusCode?: number };
  };

  return value.status ?? value.response?.status ?? value.response?.statusCode;
}

function getGitHubErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const responseData = (
    error as { response?: { data?: { message?: unknown } } }
  ).response?.data;

  return typeof responseData?.message === "string"
    ? responseData.message
    : undefined;
}

function isEmptyRepositoryRootResponse(error: unknown, path: string): boolean {
  return (
    path === "" &&
    getHttpStatus(error) === 404 &&
    getGitHubErrorMessage(error) === "This repository is empty."
  );
}

async function loadFilePayload(
  octokit: Octokit,
  owner: string,
  repo: string,
  file: { content?: string | null; encoding?: string | null; sha?: string },
): Promise<{ base64Content: string; encoding: "base64" | "utf-8" }> {
  if (file.encoding === "base64") {
    return {
      base64Content: (file.content ?? "").replace(/\s/g, ""),
      encoding: "base64",
    };
  }

  if (file.encoding === "none" && file.sha) {
    const blob = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: file.sha,
    });
    if (blob.data.encoding === "base64") {
      return {
        base64Content: blob.data.content.replace(/\s/g, ""),
        encoding: "base64",
      };
    }
    return {
      base64Content: stringToBase64(blob.data.content),
      encoding: "utf-8",
    };
  }

  return {
    base64Content: stringToBase64(file.content ?? ""),
    encoding: "utf-8",
  };
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  sha: string;
  /** For symlinks only — the target path */
  target?: string;
  /** Last commit info */
  lastCommit?: {
    author: string | null;
    date: string | null;
    message: string;
    sha: string;
  };
}

export interface FileContent {
  path: string;
  sha: string;
  size: number;
  content: string;
  base64Content: string;
  isBinary: boolean;
  encoding: "base64" | "utf-8";
  lastCommit?: {
    author: string | null;
    date: string | null;
    message: string;
    sha: string;
  };
}

export interface SearchResult {
  path: string;
  snippet: string;
  lineInFragment: number | null;
  url: string;
}

export interface CommitInfo {
  sha: string;
  author: string | null;
  date: string | null;
  message: string;
  url: string;
}

// ─── listDir ─────────────────────────────────────────────────────────────────

export async function listDir(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<FileEntry[]> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path });
    const data = res.data;

    if (Array.isArray(data)) {
      return data.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type as "file" | "dir" | "symlink",
        size: item.size ?? 0,
        sha: item.sha ?? "",
        target:
          item.type === "symlink"
            ? (item as { target?: string }).target
            : undefined,
      }));
    }

    // Single item returned means path is a file — caller should use readFile instead
    return [];
  } catch (error) {
    if (isEmptyRepositoryRootResponse(error, path)) return [];
    throw error;
  }
}

// ─── readFile ────────────────────────────────────────────────────────────────

export async function readFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<FileContent | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    const data = res.data;

    if (Array.isArray(data)) {
      // It's a directory
      return null;
    }

    if (data.type !== "file") {
      return null;
    }

    const { base64Content, encoding } = await loadFilePayload(
      octokit,
      owner,
      repo,
      data,
    );
    const bytes = base64ToBytes(base64Content);
    const isBinary = isBinaryBytes(bytes);
    const content = isBinary
      ? ""
      : new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    return {
      path: data.path ?? path,
      sha: data.sha ?? "",
      size: data.size ?? content.length,
      content,
      base64Content,
      isBinary,
      encoding,
    };
  } catch (err) {
    if (getHttpStatus(err) === 404) return null;
    throw err;
  }
}

export async function repoPathExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<boolean> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const separator = normalizedPath.lastIndexOf("/");
  const parentPath = separator === -1 ? "" : normalizedPath.slice(0, separator);
  try {
    const entries = await listDir(octokit, owner, repo, parentPath);
    return entries.some((entry) => entry.path === normalizedPath);
  } catch (error) {
    if (getHttpStatus(error) === 404) return false;
    throw error;
  }
}

// ─── writeFile ───────────────────────────────────────────────────────────────

export async function writeFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string; commitSha: string }> {
  const res = await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path,
    message,
    content: stringToBase64(content),
    ...(sha ? { sha } : {}),
  });

  return {
    sha: res.sha ?? "",
    commitSha: res.commitSha ?? "",
  };
}

// ─── deleteFile ──────────────────────────────────────────────────────────────

export async function deleteFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha,
  });
}

// ─── createSymlink ──────────────────────────────────────────────────────────

export async function createSymlink(
  octokit: Octokit,
  owner: string,
  repo: string,
  target: string,
  path: string,
  message: string,
): Promise<{ sha: string; commitSha: string }> {
  // GitHub blob type "symlink" stores the target as content
  const res = await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path,
    message,
    content: target,
    encoding: "utf-8",
  });

  return {
    sha: res.sha ?? "",
    commitSha: res.commitSha ?? "",
  };
}

// ─── uploadFile ──────────────────────────────────────────────────────────────

export async function uploadFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  blob: Blob,
  message: string,
): Promise<{ sha: string; commitSha: string }> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const base64 = bytesToBase64(bytes);

  const res = await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path,
    message,
    content: base64,
  });

  return {
    sha: res.sha ?? "",
    commitSha: res.commitSha ?? "",
  };
}

// ─── searchCode ─────────────────────────────────────────────────────────────

export async function searchCode(
  octokit: Octokit,
  owner: string,
  repo: string,
  query: string,
): Promise<{ total: number; results: SearchResult[] }> {
  const scopedQuery = `${query} repo:${owner}/${repo}`;
  const res = await octokit.rest.search.code({
    q: scopedQuery,
    per_page: 20,
    mediaType: { format: "text-match" },
  });

  type TextMatch = {
    fragment?: string;
    matches?: Array<{ indices?: number[] }>;
  };
  type Hit = {
    path: string;
    html_url: string;
    text_matches?: TextMatch[];
  };

  const results: SearchResult[] = res.data.items.flatMap((item) => {
    const tms = (item as unknown as Hit).text_matches ?? [];
    if (tms.length === 0) {
      return [
        {
          path: item.path,
          snippet: "",
          lineInFragment: null,
          url: item.html_url,
        },
      ];
    }
    return tms.map<SearchResult>((tm) => {
      const fragment = tm.fragment ?? "";
      const firstIdx = tm.matches?.[0]?.indices?.[0] ?? 0;
      const lineInFragment = lineIndexFromFragment(fragment, firstIdx);
      return {
        path: item.path,
        snippet: fragment.slice(0, 600),
        lineInFragment,
        url: item.html_url,
      };
    });
  });

  return {
    total: res.data.total_count,
    results,
  };
}

// ─── commitsForPath ─────────────────────────────────────────────────────────

export async function commitsForPath(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  perPage = 20,
): Promise<CommitInfo[]> {
  const res = await octokit.rest.repos.listCommits({
    owner,
    repo,
    path,
    per_page: perPage,
  });

  return res.data.map((c) => ({
    sha: c.sha.slice(0, 8),
    author: c.author?.login ?? c.commit.author?.name ?? null,
    date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
    message: c.commit.message.split("\n")[0] ?? "",
    url: c.html_url,
  }));
}

// ─── getFileAtRef ───────────────────────────────────────────────────────────

export async function getFileAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<FileContent | null> {
  return readFile(octokit, owner, repo, path, ref);
}

// ─── checkSymlinkTarget ─────────────────────────────────────────────────────

export async function checkSymlinkTarget(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<{ exists: boolean; target?: string }> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path });
    const data = res.data;
    if (Array.isArray(data)) return { exists: true };
    if (data.type === "symlink") {
      return {
        exists: true,
        target: (data as { target?: string }).target,
      };
    }
    return { exists: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return { exists: false };
    throw err;
  }
}
