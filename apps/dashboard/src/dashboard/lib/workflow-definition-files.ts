/**
 * @fileType utility
 * @domain kody
 * @pattern workflow-definition-files
 * @ai-summary Read, write, list, and delete local workflow definitions in
 *   the Convex backend (workflows.{get,list,save,remove}, tenant-scoped by
 *   owner/repo). Company-store workflows stay on GitHub (read-only assets).
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
  isWorkflowDefinitionId,
  normalizeWorkflowCapabilities,
  normalizeWorkflowDefinition,
  workflowDefinitionPath,
  type WorkflowDefinition,
  type WorkflowDefinitionRecord,
} from "./workflow-definitions";

const STORE_CAPABILITY_WORKFLOW_TIMESTAMP = "1970-01-01T00:00:00.000Z";

interface WorkflowDoc {
  workflowId: string;
  definition: unknown;
  source: "local" | "store";
  updatedAt: string;
}

export async function readWorkflowDefinitionFile(
  id: string,
  owner = getOwner(),
  repo = getRepo(),
): Promise<{
  workflow: WorkflowDefinition;
  sha: string;
  path: string;
  htmlUrl?: string;
} | null> {
  if (!isWorkflowDefinitionId(id)) return null;
  const path = workflowDefinitionPath(id);
  const doc = (await getConvexClient().query(backendApi.workflows.get, {
    tenantId: tenantIdFor(owner, repo),
    workflowId: id,
  })) as WorkflowDoc | null;
  if (!doc || doc.source === "store") return null;
  const workflow = normalizeWorkflowDefinition(doc.definition);
  if (!workflow) return null;
  return { workflow, sha: "", path };
}

export async function listWorkflowDefinitionFiles(
  owner = getOwner(),
  repo = getRepo(),
): Promise<WorkflowDefinitionRecord[]> {
  const docs = (await getConvexClient().query(backendApi.workflows.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as WorkflowDoc[];

  const workflows = docs
    .filter((doc) => doc.source !== "store")
    .map((doc): WorkflowDefinitionRecord | null => {
      const workflow = normalizeWorkflowDefinition(doc.definition);
      if (!workflow) return null;
      return {
        id: doc.workflowId,
        path: workflowDefinitionPath(doc.workflowId),
        workflow,
        updatedAt: workflow.updatedAt,
        source: "local",
        readOnly: false,
        runnable: true,
        htmlUrl: null,
      };
    })
    .filter((record): record is WorkflowDefinitionRecord => record !== null);

  return workflows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readCompanyStoreWorkflowDefinitionFile(
  id: string,
  octokit: Octokit = getOctokit(),
): Promise<WorkflowDefinitionRecord | null> {
  if (!isWorkflowDefinitionId(id)) return null;
  const path = await companyStoreAssetPath(
    octokit,
    "workflows",
    id,
    "workflow.json",
  );
  const raw = await readCompanyStoreText(octokit, path);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const workflow = normalizeWorkflowDefinition(parsed);
  if (!workflow) return null;
  return {
    id,
    path,
    workflow,
    updatedAt: workflow.updatedAt,
    source: "store",
    readOnly: true,
    runnable: true,
    htmlUrl: buildCompanyStoreHtmlUrl("workflows", id),
  };
}

export async function listCompanyStoreWorkflowDefinitionFiles(
  octokit: Octokit = getOctokit(),
): Promise<WorkflowDefinitionRecord[]> {
  const root = await companyStoreAssetPath(octokit, "workflows");
  const dirs = await listCompanyStoreDirectorySafe(octokit, root);
  const workflows = await Promise.all(
    dirs
      .filter(
        (entry) => entry.type === "dir" && isWorkflowDefinitionId(entry.name),
      )
      .map((entry) =>
        readCompanyStoreWorkflowDefinitionFile(entry.name, octokit),
      ),
  );
  return workflows
    .filter((workflow): workflow is WorkflowDefinitionRecord => !!workflow)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function writeWorkflowDefinitionFile({
  owner = getOwner(),
  repo = getRepo(),
  id,
  workflow,
}: {
  owner?: string;
  repo?: string;
  id: string;
  workflow: WorkflowDefinition;
}): Promise<void> {
  await getConvexClient().mutation(backendApi.workflows.save, {
    tenantId: tenantIdFor(owner, repo),
    workflowId: id,
    definition: workflow,
    source: "local",
    updatedAt: workflow.updatedAt ?? new Date().toISOString(),
  });
}

export async function deleteWorkflowDefinitionFile({
  owner = getOwner(),
  repo = getRepo(),
  id,
}: {
  owner?: string;
  repo?: string;
  id: string;
}): Promise<void> {
  await getConvexClient().mutation(backendApi.workflows.remove, {
    tenantId: tenantIdFor(owner, repo),
    workflowId: id,
  });
}
