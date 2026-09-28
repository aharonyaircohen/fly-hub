import type { Octokit } from "@octokit/rest";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  companyStoreAssetPath,
  listCompanyStoreDirectorySafe,
  readCompanyStoreText,
} from "@kody-ade/base/company-store/assets";
import { readCompanyStoreCapabilityFolderFiles } from "@dashboard/lib/capabilities";
import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";
import { ENGINE_BUILT_IN_CAPABILITIES } from "@dashboard/lib/store-solutions";
import { publishStoreExecutionDefinitions } from "@dashboard/lib/store-definition-activation";

async function readStoreTree(
  octokit: Octokit,
  root: string,
  relative = "",
  files: Record<string, string> = {},
): Promise<Record<string, string>> {
  for (const entry of await listCompanyStoreDirectorySafe(octokit, root)) {
    const absolute = `${root}/${entry.name}`;
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.type === "dir") {
      await readStoreTree(octokit, absolute, path, files);
    } else if (entry.type === "file") {
      const content = await readCompanyStoreText(octokit, absolute);
      if (content !== null) files[path] = content;
    }
  }
  return files;
}

export async function syncStoreWorkflowExecutionDefinitions(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  workflow: WorkflowDefinition;
  now?: () => string;
}): Promise<void> {
  const capabilitySlugs = input.workflow.capabilities.filter(
    (slug) => !ENGINE_BUILT_IN_CAPABILITIES.has(slug),
  );
  const agentPath = await companyStoreAssetPath(
    input.octokit,
    "agents",
    `${input.workflow.agent}.md`,
  );
  const [agent, capabilityEntries, shared] = await Promise.all([
    readCompanyStoreText(input.octokit, agentPath),
    Promise.all(
      capabilitySlugs.map(async (slug) => {
        const files = await readCompanyStoreCapabilityFolderFiles(
          slug,
          input.octokit,
        );
        if (!files) throw new Error(`Store Capability "${slug}" not found.`);
        return [slug, files] as const;
      }),
    ),
    capabilitySlugs.length === 0
      ? Promise.resolve({})
      : companyStoreAssetPath(input.octokit, "shared").then((root) =>
          readStoreTree(input.octokit, root),
        ),
  ]);
  if (agent === null) {
    throw new Error(`Store Agent "${input.workflow.agent}" not found.`);
  }
  await publishStoreExecutionDefinitions({
    tenantId: `${input.owner}/${input.repo}`,
    agents: { [input.workflow.agent]: agent },
    capabilities: Object.fromEntries(capabilityEntries),
    shared,
    createdAt: input.now?.() ?? new Date().toISOString(),
    publish: (definition) =>
      createBackendClient().mutation(backendApi.definitions.publish, definition),
  });
}
