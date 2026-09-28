import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

const CATALOG_PATHS = [
  "kody.config.json",
  "capabilities/",
  "agents/",
  "workflows/",
];

export function catalogCategoriesForChangedPaths(
  paths: string[],
): Array<
  | "config"
  | "capability"
  | "agent"
  | "goal-template"
  | "workflow-template"
  | "capability-workflow"
> {
  const categories = new Set<
    | "config"
    | "capability"
    | "agent"
    | "goal-template"
    | "workflow-template"
    | "capability-workflow"
  >();
  for (const path of paths) {
    if (path === "kody.config.json") categories.add("config");
    if (path.startsWith("capabilities/")) {
      categories.add("capability");
      categories.add("capability-workflow");
    }
    if (path.startsWith("agents/")) categories.add("agent");
    if (path.startsWith("workflows/")) categories.add("workflow-template");
  }
  return [...categories];
}

export async function invalidateCatalogProjection(
  repoFullName: string,
  changedPaths: string[],
): Promise<void> {
  if (!process.env.CONVEX_URL || !process.env.KODY_SERVICE_KEY) return;
  const categories = catalogCategoriesForChangedPaths(changedPaths);
  if (categories.length === 0) return;
  if (repoFullName.split("/").length !== 2) return;
  await createBackendClient().mutation(backendApi.catalog.clearCategories, {
    tenantId: repoFullName,
    categories,
  });
}

export function isCatalogRelevantPath(path: string): boolean {
  return CATALOG_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
}
