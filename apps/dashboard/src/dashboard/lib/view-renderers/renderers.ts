/**
 * @fileType util
 * @domain view-renderers
 * @pattern convex-config
 * @ai-summary User-managed renderer definitions stored in the Convex
 *   backend (viewRenderers.{list,save,remove}, tenant-scoped by owner/repo).
 *   Template resolution lives in template.ts; the model-facing spec
 *   contract in spec/. This file owns storage CRUD and prompt-context
 *   loading.
 */
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../backend/convex-backend";
import {
  VIEW_RENDERER_SLUG_RE,
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  viewRendererDefinitionVersion,
  type ViewRendererDefinition,
} from "./definition";
import {
  BUILTIN_VIEW_RENDERER_DEFINITIONS,
  getBuiltinViewRendererDefinition,
} from "./builtin";
import { buildChatViewCatalog } from "./spec/catalog";
import { buildViewComponentRules } from "./spec/prompt";

export const VIEW_RENDERERS_DIR = "views/renderers";

export function isValidViewRendererSlug(slug: string): boolean {
  return VIEW_RENDERER_SLUG_RE.test(slug);
}
export {
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  type ViewRendererDefinition,
};
export {
  buildRenderedViewDirective,
  mergeViewRendererDefaults,
  normalizeViewRendererData,
  resolveViewRendererUi,
} from "./template";

export interface ViewRendererDefinitionFile {
  definition: ViewRendererDefinition;
  source: "repo" | "builtin";
  sha: string;
  htmlUrl: string;
}

function builtinDefinitionFile(
  definition: ViewRendererDefinition,
): ViewRendererDefinitionFile {
  return { definition, source: "builtin", sha: "", htmlUrl: "" };
}

export interface ViewRendererPromptContext {
  rules: string | null;
  definitions: ViewRendererDefinition[];
}

interface ViewRendererDoc {
  slug: string;
  version?: number;
  definition: unknown;
}

function fileFromDoc(doc: ViewRendererDoc): ViewRendererDefinitionFile {
  return {
    definition: {
      ...parseViewRendererDefinition(JSON.stringify(doc.definition)),
      version: doc.version ?? 1,
    },
    source: "repo",
    sha: "",
    htmlUrl: "",
  };
}

export async function readViewRendererDefinitionFile({
  owner,
  repo,
  slug,
}: {
  owner: string;
  repo: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile | null> {
  return readViewRendererDefinitionForTenant({
    tenantId: tenantIdFor(owner, repo),
    slug,
  });
}

export async function readViewRendererDefinitionForTenant({
  tenantId,
  slug,
}: {
  tenantId: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile | null> {
  if (!isValidViewRendererSlug(slug)) return null;
  const docs = (await getConvexClient().query(backendApi.viewRenderers.list, {
    tenantId,
  })) as ViewRendererDoc[];
  const doc = docs.find((d) => d.slug === slug);
  if (doc) return fileFromDoc(doc);
  const builtin = getBuiltinViewRendererDefinition(slug);
  return builtin ? builtinDefinitionFile(builtin) : null;
}

export async function resolveViewRendererDefinition({
  owner,
  repo,
  slug,
}: {
  owner: string;
  repo: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile> {
  const file = await readViewRendererDefinitionFile({
    owner,
    repo,
    slug,
  });
  if (file) return file;
  throw new Error(`View renderer "${slug}" not found`);
}

export async function loadViewRendererRulesForPrompt({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): Promise<string | null> {
  return (await loadViewRendererContextForPrompt({ owner, repo })).rules;
}

export async function loadViewRendererContextForPrompt({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): Promise<ViewRendererPromptContext> {
  return loadViewRendererContextForTenant(tenantIdFor(owner, repo));
}

export async function loadViewRendererContextForTenant(
  tenantId: string,
): Promise<ViewRendererPromptContext> {
  const files = await listViewRendererDefinitionsForTenant(tenantId);
  const definitions = files
    .map((file) => file.definition)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    rules: buildViewComponentRules(buildChatViewCatalog(definitions)),
    definitions,
  };
}

export async function listViewRendererDefinitionFiles({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): Promise<ViewRendererDefinitionFile[]> {
  return listViewRendererDefinitionsForTenant(tenantIdFor(owner, repo));
}

export async function listViewRendererDefinitionsForTenant(
  tenantId: string,
): Promise<ViewRendererDefinitionFile[]> {
  const docs = (await getConvexClient().query(backendApi.viewRenderers.list, {
    tenantId,
  })) as ViewRendererDoc[];
  const repoFiles = docs
    .map((doc) => {
      try {
        return fileFromDoc(doc);
      } catch {
        return null;
      }
    })
    .filter((file): file is ViewRendererDefinitionFile => Boolean(file));
  const repoSlugs = new Set(repoFiles.map((file) => file.definition.slug));
  const builtins = BUILTIN_VIEW_RENDERER_DEFINITIONS.filter(
    (definition) => !repoSlugs.has(definition.slug),
  ).map(builtinDefinitionFile);
  return [...repoFiles, ...builtins];
}

export async function writeViewRendererDefinitionFile({
  owner,
  repo,
  definition,
}: {
  owner: string;
  repo: string;
  definition: ViewRendererDefinition;
}): Promise<ViewRendererDefinitionFile> {
  return writeViewRendererDefinitionForTenant({
    tenantId: tenantIdFor(owner, repo),
    definition,
  });
}

export async function writeViewRendererDefinitionForTenant({
  tenantId,
  definition,
}: {
  tenantId: string;
  definition: ViewRendererDefinition;
}): Promise<ViewRendererDefinitionFile> {
  // Round-trip through the serializer so only schema-valid data persists.
  const validated = JSON.parse(
    serializeViewRendererDefinition(definition),
  ) as ViewRendererDefinition;
  const savedVersion = await getConvexClient().mutation(
    backendApi.viewRenderers.save,
    {
      tenantId,
      slug: definition.slug,
      definition: validated,
      updatedAt: new Date().toISOString(),
    },
  );
  const version =
    typeof savedVersion === "number"
      ? savedVersion
      : viewRendererDefinitionVersion(validated);
  return {
    definition: { ...validated, version },
    source: "repo",
    sha: "",
    htmlUrl: "",
  };
}

export async function deleteViewRendererDefinitionFile({
  owner,
  repo,
  slug,
}: {
  owner: string;
  repo: string;
  slug: string;
}): Promise<void> {
  return deleteViewRendererDefinitionForTenant({
    tenantId: tenantIdFor(owner, repo),
    slug,
  });
}

export async function deleteViewRendererDefinitionForTenant({
  tenantId,
  slug,
}: {
  tenantId: string;
  slug: string;
}): Promise<void> {
  await getConvexClient().mutation(backendApi.viewRenderers.remove, {
    tenantId,
    slug,
  });
}
