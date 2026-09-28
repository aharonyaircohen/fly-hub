import type { Octokit } from "@octokit/rest";
import { KODY_CONFIG_PATH } from "@kody-ade/base/engine/config";

import { KODY_ENGINE_WORKFLOW_PATH } from "./paths";
import type {
  EngineSetupFileStatus,
  EngineSetupStatus,
} from "./status-contract";

interface GetEngineSetupStatusInput {
  octokit: Octokit;
  owner: string;
  repo: string;
}

function githubStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

async function getFileStatus(
  input: GetEngineSetupStatusInput,
  path: string,
): Promise<EngineSetupFileStatus> {
  try {
    const response = await input.octokit.rest.repos.getContent({
      owner: input.owner,
      repo: input.repo,
      path,
    });
    return Array.isArray(response.data) ? "unknown" : "present";
  } catch (error) {
    return githubStatus(error) === 404 ? "missing" : "unknown";
  }
}

export async function getEngineSetupStatus(
  input: GetEngineSetupStatusInput,
): Promise<EngineSetupStatus> {
  const [workflow, config] = await Promise.all([
    getFileStatus(input, KODY_ENGINE_WORKFLOW_PATH),
    getFileStatus(input, KODY_CONFIG_PATH),
  ]);
  const files = { workflow, config };

  if (workflow === "unknown" || config === "unknown") {
    return { status: "unknown", files, error: "github_access_failed" };
  }
  return {
    status:
      workflow === "present" && config === "present"
        ? "ready"
        : "setup_required",
    files,
  };
}
