/**
 * @fileType utility
 * @domain kody
 * @pattern pipeline-definition-files
 * @ai-summary Convex-backed local Pipeline definitions plus read-only Store
 *   Pipeline assets, matching Workflow ownership behavior.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, getOwner, getRepo } from "./github-client";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "./backend/convex-backend";
import {
  buildCompanyStoreHtmlUrl,
  companyStoreAssetPath,
  listCompanyStoreDirectorySafe,
  readCompanyStoreText,
} from "./company-store/assets";
import {
  isPipelineDefinitionId,
  normalizePipelineDefinition,
  pipelineDefinitionPath,
  type PipelineDefinition,
  type PipelineDefinitionRecord,
} from "./pipeline-definitions";

interface PipelineDoc {
  pipelineId: string;
  definition: unknown;
  source: "local" | "store";
  updatedAt: string;
}

export async function readPipelineDefinitionFile(
  id: string,
  owner = getOwner(),
  repo = getRepo(),
): Promise<{ pipeline: PipelineDefinition; path: string } | null> {
  if (!isPipelineDefinitionId(id)) return null;
  const doc = (await getConvexClient().query(backendApi.pipelines.get, {
    tenantId: tenantIdFor(owner, repo),
    pipelineId: id,
  })) as PipelineDoc | null;
  if (!doc || doc.source === "store") return null;
  const pipeline = normalizePipelineDefinition(doc.definition);
  return pipeline
    ? { pipeline, path: pipelineDefinitionPath(id) }
    : null;
}

export async function listPipelineDefinitionFiles(
  owner = getOwner(),
  repo = getRepo(),
): Promise<PipelineDefinitionRecord[]> {
  const docs = (await getConvexClient().query(backendApi.pipelines.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as PipelineDoc[];
  return docs
    .filter((doc) => doc.source === "local")
    .flatMap((doc): PipelineDefinitionRecord[] => {
      const pipeline = normalizePipelineDefinition(doc.definition);
      return pipeline
        ? [{
            id: doc.pipelineId,
            path: pipelineDefinitionPath(doc.pipelineId),
            pipeline,
            source: "local",
            readOnly: false,
            runnable: true,
            updatedAt: doc.updatedAt,
            htmlUrl: null,
          }]
        : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function readCompanyStorePipelineDefinitionFile(
  id: string,
  octokit: Octokit = getOctokit(),
): Promise<PipelineDefinitionRecord | null> {
  if (!isPipelineDefinitionId(id)) return null;
  const path = await companyStoreAssetPath(
    octokit,
    "pipelines",
    id,
    "pipeline.json",
  );
  const raw = await readCompanyStoreText(octokit, path);
  if (!raw) return null;
  try {
    const pipeline = normalizePipelineDefinition(JSON.parse(raw));
    return pipeline
      ? {
          id,
          path,
          pipeline,
          source: "store",
          readOnly: true,
          runnable: true,
          updatedAt: pipeline.updatedAt,
          htmlUrl: buildCompanyStoreHtmlUrl("pipelines", id),
        }
      : null;
  } catch {
    return null;
  }
}

export async function listCompanyStorePipelineDefinitionFiles(
  octokit: Octokit = getOctokit(),
): Promise<PipelineDefinitionRecord[]> {
  const root = await companyStoreAssetPath(octokit, "pipelines");
  const dirs = await listCompanyStoreDirectorySafe(octokit, root);
  const pipelines = await Promise.all(
    dirs
      .filter(
        (entry) => entry.type === "dir" && isPipelineDefinitionId(entry.name),
      )
      .map((entry) =>
        readCompanyStorePipelineDefinitionFile(entry.name, octokit),
      ),
  );
  return pipelines
    .filter((pipeline): pipeline is PipelineDefinitionRecord => !!pipeline)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function writePipelineDefinitionFile(input: {
  owner?: string;
  repo?: string;
  id: string;
  pipeline: PipelineDefinition;
}): Promise<void> {
  await getConvexClient().mutation(backendApi.pipelines.save, {
    tenantId: tenantIdFor(input.owner ?? getOwner(), input.repo ?? getRepo()),
    pipelineId: input.id,
    definition: input.pipeline,
    source: "local",
    updatedAt: input.pipeline.updatedAt,
  });
}

export async function deletePipelineDefinitionFile(input: {
  owner?: string;
  repo?: string;
  id: string;
}): Promise<void> {
  await getConvexClient().mutation(backendApi.pipelines.remove, {
    tenantId: tenantIdFor(input.owner ?? getOwner(), input.repo ?? getRepo()),
    pipelineId: input.id,
  });
}
