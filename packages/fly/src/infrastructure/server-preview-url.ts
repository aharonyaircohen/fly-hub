import { getDeploymentProvider } from "./installed";
import { logger } from "@kody-ade/base/logger";
import { resolvePreviewConfigForOctokit } from "../previews/config";
import type { Octokit } from "@octokit/rest";

export async function serverProviderPrPreviewUrl(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: number,
): Promise<string | null> {
  try {
    const cfg = await resolvePreviewConfigForOctokit({ octokit, owner, repo });
    if (!cfg) return null;
    const info = (await getDeploymentProvider().get(
      { repo: `${owner}/${repo}`, pr },
      cfg,
    )) as { url?: string | null } | null;
    return info?.url ?? null;
  } catch (err) {
    logger.warn(
      { err, owner, repo, pr },
      "server provider preview url lookup failed; falling back",
    );
    return null;
  }
}
