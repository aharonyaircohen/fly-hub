import { backendApi, getConvexClient, tenantIdFor } from "./convex-backend";

export type CatalogCategory =
  | "config"
  | "capability"
  | "agent"
  | "goal-template"
  | "workflow-template"
  | "capability-workflow";

export interface CatalogEntry<T = unknown> {
  tenantId: string;
  category: CatalogCategory;
  slug: string;
  doc: T;
  source: string;
  sourceUpdatedAt?: string;
  updatedAt: string;
}

export async function listCatalogEntries<T = unknown>(
  owner: string,
  repo: string,
  category: CatalogCategory,
): Promise<CatalogEntry<T>[]> {
  return (await getConvexClient().query(backendApi.catalog.list, {
    tenantId: tenantIdFor(owner, repo),
    category,
  })) as CatalogEntry<T>[];
}

export async function saveCatalogEntry<T = unknown>(
  owner: string,
  repo: string,
  category: CatalogCategory,
  slug: string,
  doc: T,
  source: string,
  sourceUpdatedAt?: string,
): Promise<void> {
  await getConvexClient().mutation(backendApi.catalog.save, {
    tenantId: tenantIdFor(owner, repo),
    category,
    slug,
    doc,
    source,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    updatedAt: new Date().toISOString(),
  });
}
