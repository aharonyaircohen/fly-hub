import type { Octokit } from "@octokit/rest";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  readCompanyStoreWorkflowDefinitionFile,
  readWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";
import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";
import { effectiveActiveWorkflowIds } from "@dashboard/features/workflows/built-in-workflows";
import { syncStoreWorkflowExecutionDefinitions } from "@dashboard/lib/store-workflow-execution-sync";

interface CompanyWorkflowLoaderOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  syncStoreDefinitions?: boolean;
  allowedStoreWorkflowIds?: ReadonlySet<string>;
}

export function createCompanyWorkflowLoader({
  octokit,
  owner,
  repo,
  syncStoreDefinitions = false,
  allowedStoreWorkflowIds = new Set(),
}: CompanyWorkflowLoaderOptions) {
  return async function loadWorkflow(
    workflowId: string,
  ): Promise<{ workflow: WorkflowDefinition } | null> {
    if (syncStoreDefinitions && allowedStoreWorkflowIds.has(workflowId)) {
      const approvedStore = await readCompanyStoreWorkflowDefinitionFile(
        workflowId,
        octokit,
      );
      if (approvedStore) {
        await syncStoreWorkflowExecutionDefinitions({
          octokit,
          owner,
          repo,
          workflow: approvedStore.workflow,
        });
        return approvedStore;
      }
    }

    const local = await readWorkflowDefinitionFile(workflowId, owner, repo);
    if (local) return local;

    // Webhook bursts must reuse the normal 60s config cache. A forced GitHub
    // read here would spend one API request per matching event.
    const { config } = await getEngineConfig(octokit, owner, repo);
    const active = effectiveActiveWorkflowIds(config.company?.activeWorkflows);
    if (!active.has(workflowId) && !allowedStoreWorkflowIds.has(workflowId)) {
      return null;
    }
    const store = await readCompanyStoreWorkflowDefinitionFile(
      workflowId,
      octokit,
    );
    if (store && syncStoreDefinitions) {
      await syncStoreWorkflowExecutionDefinitions({
        octokit,
        owner,
        repo,
        workflow: store.workflow,
      });
    }
    return store;
  };
}
