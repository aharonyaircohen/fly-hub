import { createHash } from "node:crypto";
import {
  detectAppSource,
  detectAppVerification,
  detectRuntimeEnvironment,
} from "../apps/source-detector";

export function parsePublicGitHubRepo(value: string): {
  owner: string;
  repo: string;
} {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a GitHub repository URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com")
    throw new Error("Enter a public github.com repository URL.");
  const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (
    parts.length !== 2 ||
    !parts.every(
      (part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..",
    )
  )
    throw new Error(
      "Use a repository URL such as https://github.com/owner/repo.",
    );
  const repo = parts[1].replace(/\.git$/, "");
  if (!repo) throw new Error("Enter a GitHub repository URL.");
  return { owner: parts[0], repo };
}

export function flyHubAppName(
  org: string,
  owner: string,
  repo: string,
  root: string,
): string {
  const slug = `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 32)
    .replace(/-+$/, "");
  const hash = createHash("sha256")
    .update(`${org}/${owner}/${repo}/${root}`.toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return `flyhub-app-${slug}-${hash}`;
}

async function githubJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "fly-hub" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404)
    throw new Error("Repository not found or not public.");
  if (!response.ok)
    throw new Error(`GitHub inspection failed (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

export async function inspectPublicGitHubApp(input: {
  url: string;
  org: string;
  rootDirectory?: string;
}) {
  const { owner, repo } = parsePublicGitHubRepo(input.url);
  const rootDirectory =
    input.rootDirectory
      ?.trim()
      .replace(/^\.\//, "")
      .replace(/^\/+|\/+$/g, "") || ".";
  if (
    rootDirectory !== "." &&
    (rootDirectory.includes("..") || !/^[\w./-]+$/.test(rootDirectory))
  )
    throw new Error("Invalid app directory.");
  const repository = await githubJson<{
    default_branch: string;
    private: boolean;
  }>(`/repos/${owner}/${repo}`);
  if (repository.private)
    throw new Error("The first version supports public repositories only.");
  const branch = await githubJson<{
    commit: { sha: string; tree: { sha: string } };
  }>(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(repository.default_branch)}`,
  );
  const commitSha = branch.commit.sha;
  const tree = await githubJson<{
    truncated: boolean;
    tree: Array<{ path: string; type: string; size?: number }>;
  }>(`/repos/${owner}/${repo}/git/trees/${branch.commit.tree.sha}?recursive=1`);
  if (tree.truncated)
    throw new Error("Repository is too large to inspect automatically.");
  const files = tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path);
  const prefix = rootDirectory === "." ? "" : `${rootDirectory}/`;
  const relevant =
    /(^|\/)(Dockerfile|fly\.toml|package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.(?:js|mjs)|requirements\.txt|pyproject\.toml|Procfile|index\.html|\.env\.(?:example|sample|template))$/;
  const paths = tree.tree
    .filter(
      (item) =>
        item.type === "blob" &&
        item.path.startsWith(prefix) &&
        (item.size ?? 0) <= 262_144 &&
        relevant.test(item.path),
    )
    .map((item) => item.path);
  const entries = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${path.split("/").map(encodeURIComponent).join("/")}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        },
      );
      return { path, text: response.ok ? await response.text() : "" };
    }),
  );
  const content = new Map(entries.map((entry) => [entry.path, entry.text]));
  const plan = detectAppSource({
    files,
    rootDirectory,
    readText: (path) => content.get(path),
  });
  const environment = detectRuntimeEnvironment(entries);
  return {
    repository: `${owner}/${repo}`,
    name: repo,
    appName: flyHubAppName(input.org, owner, repo, rootDirectory),
    commitSha,
    branch: repository.default_branch,
    plan: {
      ...plan,
      verification: detectAppVerification(entries),
      runtimeEnv: environment.runtimeEnv,
      generatedSecretNames: environment.generatedSecretNames,
    },
    requiredSecretNames: environment.requiredSecretNames,
  };
}
