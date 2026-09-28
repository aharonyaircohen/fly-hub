import type { Octokit } from "@octokit/rest";

import { listCompanyStoreWorkflowDefinitionFiles } from "../workflow-definition-files";

export interface InstalledCapabilityConfig {
  company?: {
    activeCapabilities?: unknown;
    activeWorkflows?: unknown;
  };
}

function slugs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function resolveInstalledCapabilitySlugs(
  octokit: Octokit,
  config: InstalledCapabilityConfig,
): Promise<Set<string>> {
  const installed = new Set(slugs(config.company?.activeCapabilities));
  const activeWorkflows = new Set(slugs(config.company?.activeWorkflows));
  if (!activeWorkflows.size) return installed;
  for (const workflow of await listCompanyStoreWorkflowDefinitionFiles(octokit)) {
    if (!activeWorkflows.has(workflow.id)) continue;
    for (const capability of workflow.workflow.capabilities) {
      installed.add(capability);
    }
  }
  return installed;
}
