import type { Octokit } from "@octokit/rest";

import {
  listCompanyStoreAssetSlugs,
  listCompanyStoreMarkdownAssetSlugs,
} from "@kody-ade/base/company-store/assets";

const CATALOG_SLUG = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export interface StoreCatalogSlugs {
  capabilities: string[];
  agents: string[];
  commands: string[];
  workflows: string[];
  pipelines: string[];
  loops: string[];
  triggers: string[];
  solutions: string[];
  strategies: string[];
}

export async function listStoreCatalogSlugs(
  octokit: Octokit,
): Promise<StoreCatalogSlugs> {
  const [
    capabilities,
    agents,
    commands,
    workflows,
    pipelines,
    loops,
    triggers,
    solutions,
    strategies,
  ] = await Promise.all([
    listCompanyStoreAssetSlugs(octokit, "capabilities", isCatalogSlug),
    listCompanyStoreMarkdownAssetSlugs(octokit, "agents", isCatalogSlug),
    listCompanyStoreMarkdownAssetSlugs(octokit, "commands", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "workflows", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "pipelines", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "loops", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "triggers", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "solutions", isCatalogSlug),
    listCompanyStoreAssetSlugs(octokit, "strategies", isCatalogSlug),
  ]);
  return {
    capabilities,
    agents,
    commands,
    workflows,
    pipelines,
    loops,
    triggers,
    solutions,
    strategies,
  };
}

function isCatalogSlug(slug: string): boolean {
  return CATALOG_SLUG.test(slug);
}
