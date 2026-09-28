import type { Octokit } from "@octokit/rest";
import {
  detectAppSource,
  detectAppVerification,
  detectRuntimeEnvironment,
  generateFlyAppName,
} from "@kody-ade/fly/apps/source-detector";
const relevant =
  /(^|\/)(Dockerfile|fly\.toml|docker-compose\.ya?ml|compose\.ya?ml|package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|next\.config\.(?:js|mjs)|requirements\.txt|pyproject\.toml|Procfile|index\.html|\.env\.(?:example|sample|template))$/;
const sourceFile = /\.(?:[cm]?[jt]sx?|py|mjs|cjs)$/i;
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
export function normalizeSingleMachineRuntimeEnvironment(
  runtimeEnv: Record<string, string>,
  compose: string,
  dockerBuildTarget?: string,
) {
  if (dockerBuildTarget !== "single") return runtimeEnv;
  const serviceNames = new Set(
    [...compose.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm)].map(
      (match) => match[1],
    ),
  );
  return Object.fromEntries(
    Object.entries(runtimeEnv).map(([key, value]) => [
      key,
      value.replace(
        /(:\/\/)([A-Za-z0-9_-]+)(:\d+)/,
        (all, scheme: string, host: string, port: string) =>
          serviceNames.has(host) ? `${scheme}127.0.0.1${port}` : all,
      ),
    ]),
  );
}
export async function inspectRepositoryApp(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  rootDirectory?: string;
  ref?: string;
  name?: string;
}) {
  const repository = await input.octokit.rest.repos.get({
      owner: input.owner,
      repo: input.repo,
    }),
    ref = input.ref || repository.data.default_branch,
    commit = await input.octokit.rest.repos.getCommit({
      owner: input.owner,
      repo: input.repo,
      ref,
    }),
    tree = await input.octokit.rest.git.getTree({
      owner: input.owner,
      repo: input.repo,
      tree_sha: commit.data.commit.tree.sha,
      recursive: "true",
    });
  const blobs = tree.data.tree.filter(
      (item) => item.type === "blob" && item.path,
    ),
    files = blobs.map((item) => item.path!);
  const rootPrefix = input.rootDirectory?.replace(/^\/+|\/+$/g, "");
  const sourcePaths = blobs
    .filter(
      (item) =>
        sourceFile.test(item.path!) &&
        (item.size ?? 0) <= 262144 &&
        (!rootPrefix ||
          item.path === rootPrefix ||
          item.path!.startsWith(`${rootPrefix}/`)),
    )
    .slice(0, 200)
    .map((item) => item.path!);
  const paths = Array.from(
    new Set([...files.filter((path) => relevant.test(path)), ...sourcePaths]),
  );
  const entries = await Promise.all(
    paths.map(async (path) => {
      const response = await input.octokit.rest.repos.getContent({
          owner: input.owner,
          repo: input.repo,
          path,
          ref: commit.data.sha,
        }),
        data = response.data;
      return {
        path,
        text:
          !Array.isArray(data) && data.type === "file" && "content" in data
            ? Buffer.from(data.content, "base64").toString("utf8")
            : "",
      };
    }),
  );
  const content = new Map(entries.map((entry) => [entry.path, entry.text])),
    detectedPlan = detectAppSource({
      files,
      rootDirectory: input.rootDirectory,
      readText: (path) => content.get(path),
    }),
    environment = detectRuntimeEnvironment(entries),
    name = input.name ?? input.repo,
    slug = slugify(name);
  const compose =
    entries.find((entry) =>
      /(^|\/)(?:docker-)?compose\.ya?ml$/.test(entry.path),
    )?.text ?? "";
  const runtimeEnv = normalizeSingleMachineRuntimeEnvironment(
    environment.runtimeEnv,
    compose,
    detectedPlan.dockerBuildTarget,
  );
  const plan = {
    ...detectedPlan,
    verification: detectAppVerification(entries),
    ...(Object.keys(runtimeEnv).length ? { runtimeEnv } : {}),
    ...(environment.generatedSecretNames.length
      ? { generatedSecretNames: environment.generatedSecretNames }
      : {}),
  };
  return {
    repository: `${input.owner}/${input.repo}`,
    ref,
    commitSha: commit.data.sha,
    name,
    slug,
    providerAppName: generateFlyAppName(`${input.owner}/${input.repo}`, slug),
    plan,
    requiredSecretNames: environment.requiredSecretNames,
  };
}
