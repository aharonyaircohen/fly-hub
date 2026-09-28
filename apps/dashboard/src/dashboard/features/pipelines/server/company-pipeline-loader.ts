import type { Octokit } from "@octokit/rest";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  readCompanyStorePipelineDefinitionFile,
  readPipelineDefinitionFile,
} from "@dashboard/lib/pipeline-definition-files";

function activeIds(value: string[] | undefined): Set<string> {
  return new Set((value ?? []).filter(Boolean));
}

export function createCompanyPipelineLoader(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
}) {
  return async (pipelineId: string) => {
    const local = await readPipelineDefinitionFile(
      pipelineId,
      input.owner,
      input.repo,
    );
    if (local) return local;
    const { config } = await getEngineConfig(
      input.octokit,
      input.owner,
      input.repo,
    );
    if (!activeIds(config.company?.activePipelines).has(pipelineId)) return null;
    const store = await readCompanyStorePipelineDefinitionFile(
      pipelineId,
      input.octokit,
    );
    return store ? { pipeline: store.pipeline, path: store.path } : null;
  };
}
