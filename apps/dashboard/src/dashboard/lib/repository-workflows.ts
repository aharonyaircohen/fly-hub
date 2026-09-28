import type { Octokit } from "@octokit/rest";

import {
  readGitHubFileForWrite,
  writeGitHubFileWithRetry,
} from "@kody-ade/base/github-contents-write";
import {
  isWorkflowDefinitionId,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from "@dashboard/lib/workflow-definitions";

const ROOT = ".kody-engine/definitions/workflows";

function workflowPath(id: string): string {
  return `${ROOT}/${id}/workflow.json`;
}

export function prepareRepositoryWorkflowFile(
  id: string,
  value: unknown,
): {
  workflow: WorkflowDefinition;
  path: string;
  content: string;
} {
  if (!isWorkflowDefinitionId(id)) {
    throw new Error(`Invalid Workflow id "${id}"`);
  }
  const workflow = normalizeWorkflowDefinition(value);
  if (!workflow || validateWorkflowDefinition(workflow).length > 0) {
    throw new Error(`Invalid Workflow definition "${id}"`);
  }
  return {
    workflow,
    path: workflowPath(id),
    content: `${JSON.stringify(workflow, null, 2)}\n`,
  };
}

export async function saveRepositoryWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  id: string,
  value: unknown,
  message: string,
): Promise<{
  workflow: WorkflowDefinition;
  created: boolean;
  written: boolean;
}> {
  const { workflow, path, content } = prepareRepositoryWorkflowFile(id, value);
  const existing = await readGitHubFileForWrite(octokit, owner, repo, path);
  if (existing?.contentBase64) {
    try {
      const current = normalizeWorkflowDefinition(
        JSON.parse(Buffer.from(existing.contentBase64, "base64").toString("utf8")),
      );
      if (current && JSON.stringify(current) === JSON.stringify(workflow)) {
        return { workflow, created: false, written: false };
      }
    } catch {
      // Replace malformed content with the validated Store definition.
    }
  }
  await writeGitHubFileWithRetry(octokit, {
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    sha: existing?.sha,
  });
  return { workflow, created: !existing, written: true };
}

export async function deleteRepositoryWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  id: string,
  message: string,
): Promise<boolean> {
  if (!isWorkflowDefinitionId(id)) return false;
  const path = workflowPath(id);
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
