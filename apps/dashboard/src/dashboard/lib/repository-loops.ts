import type { Octokit } from "@octokit/rest";

import {
  createLoopDefinition,
  type LoopDefinition,
} from "@kody-ade/agency-domain";
import {
  readGitHubFileForWrite,
  writeGitHubFileWithRetry,
} from "@kody-ade/base/github-contents-write";

const ROOT = ".kody-engine/definitions/loops";
const ID = /^[a-z][a-z0-9-]{0,127}$/;

function loopPath(id: string): string {
  return `${ROOT}/${id}/loop.json`;
}

export function prepareRepositoryLoopFile(value: unknown): {
  loop: LoopDefinition;
  path: string;
  content: string;
} {
  const loop = createLoopDefinition(value);
  return {
    loop,
    path: loopPath(loop.id),
    content: `${JSON.stringify(loop, null, 2)}\n`,
  };
}

function decode(content: string | null): string {
  return Buffer.from((content ?? "").replace(/\n/g, ""), "base64").toString(
    "utf8",
  );
}

function normalizeStoredLoop(value: unknown): LoopDefinition {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const legacy = value as {
      target?: { kind?: unknown; id?: unknown };
      input?: unknown;
    };
    if (
      legacy.target?.kind === "agent" &&
      typeof legacy.target.id === "string" &&
      legacy.input &&
      typeof legacy.input === "object" &&
      !Array.isArray(legacy.input)
    ) {
      return createLoopDefinition({
        ...value,
        target: { kind: "capability", id: "live-agent" },
        input: {
          ...(legacy.input as Record<string, unknown>),
          agent: legacy.target.id,
        },
      });
    }
  }
  return createLoopDefinition(value);
}

export async function readRepositoryLoop(
  octokit: Octokit,
  owner: string,
  repo: string,
  id: string,
): Promise<LoopDefinition | null> {
  if (!ID.test(id)) return null;
  const file = await readGitHubFileForWrite(octokit, owner, repo, loopPath(id));
  if (!file?.contentBase64) return null;
  try {
    const loop = normalizeStoredLoop(JSON.parse(decode(file.contentBase64)));
    return loop.id === id ? loop : null;
  } catch {
    return null;
  }
}

export async function listRepositoryLoops(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<LoopDefinition[]> {
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: ROOT,
    });
    if (!Array.isArray(response.data)) return [];
    const ids = response.data
      .filter((entry) => entry.type === "dir" && ID.test(entry.name))
      .map((entry) => entry.name);
    const loops = await Promise.all(
      ids.map((id) => readRepositoryLoop(octokit, owner, repo, id)),
    );
    return loops.filter((loop): loop is LoopDefinition => loop !== null);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { status?: number }).status === 404
    ) {
      return [];
    }
    throw error;
  }
}

export async function saveRepositoryLoop(
  octokit: Octokit,
  owner: string,
  repo: string,
  value: unknown,
  message: string,
): Promise<{ loop: LoopDefinition; created: boolean }> {
  const { loop, path, content } = prepareRepositoryLoopFile(value);
  const existing = await readGitHubFileForWrite(octokit, owner, repo, path);
  await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    sha: existing?.sha,
  });
  return { loop, created: !existing };
}

export async function deleteRepositoryLoop(
  octokit: Octokit,
  owner: string,
  repo: string,
  id: string,
  message: string,
): Promise<boolean> {
  if (!ID.test(id)) return false;
  const path = loopPath(id);
  const existing = await readGitHubFileForWrite(octokit, owner, repo, path);
  if (!existing?.sha) return false;
  await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha: existing.sha,
  });
  return true;
}
