/**
 * @fileType util
 * @domain view-renderers
 * @pattern standalone-renderer-store
 * @ai-summary User-managed renderer definitions stored under
 *   `views/renderers/<slug>.json` in the Kody backend. Template
 *   resolution lives in template.ts; the model-facing spec contract in
 *   spec/. This file owns storage CRUD and prompt-context loading.
 */
import type { Octokit } from "@octokit/rest";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  BUILTIN_VIEW_RENDERER_DEFINITIONS,
  getBuiltinViewRendererDefinition,
} from "./builtin";
import {
  VIEW_RENDERER_SLUG_RE,
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  viewRendererDefinitionVersion,
  type ViewRendererDefinition,
} from "./definition";
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

function filePathForSlug(slug: string): string {
  return `${VIEW_RENDERERS_DIR}/${slug}.json`;
}

export async function readViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  slug,
  version,
}: {
  octokit?: Octokit;
  owner: string;
  repo: string;
  slug: string;
  version?: number;
}): Promise<ViewRendererDefinitionFile | null> {
  if (!isValidViewRendererSlug(slug)) return null;
  void octokit;
  const row = (
    version === undefined
      ? (
          await createBackendClient().query(api.viewRenderers.list, {
            tenantId: `${owner}/${repo}`,
          })
        ).find((entry: { slug: string }) => entry.slug === slug)
      : await createBackendClient().query(api.viewRenderers.getVersion, {
          tenantId: `${owner}/${repo}`,
          slug,
          version,
        })
  ) as
    | {
        definition: ViewRendererDefinition;
        version?: number;
        updatedAt?: string;
      }
    | undefined;
  if (!row) {
    // No repo override — fall back to the packaged built-in, if any.
    const builtin = getBuiltinViewRendererDefinition(slug);
    return builtin && (version === undefined || version === 1)
      ? builtinDefinitionFile(builtin)
      : null;
  }
  return {
    definition: {
      ...parseViewRendererDefinition(JSON.stringify(row.definition)),
      version: row.version ?? 1,
    },
    source: "repo",
    sha: row.updatedAt ?? "convex",
    htmlUrl: "",
  };
}

export async function resolveViewRendererDefinition({
  octokit,
  owner,
  repo,
  slug,
}: {
  octokit?: Octokit;
  owner: string;
  repo: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile> {
  const file = await readViewRendererDefinitionFile({
    octokit,
    owner,
    repo,
    slug,
  });
  if (file) return file;
  throw new Error(`View renderer "${slug}" not found`);
}

export async function loadViewRendererRulesForPrompt({
  octokit,
  owner,
  repo,
}: {
  octokit?: Octokit;
  owner: string;
  repo: string;
}): Promise<string | null> {
  return (await loadViewRendererContextForPrompt({ octokit, owner, repo }))
    .rules;
}

export async function loadViewRendererContextForPrompt({
  octokit,
  owner,
  repo,
}: {
  octokit?: Octokit;
  owner: string;
  repo: string;
}): Promise<ViewRendererPromptContext> {
  void octokit;
  return loadViewRendererContextForTenant(`${owner}/${repo}`);
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
  octokit,
  owner,
  repo,
}: {
  octokit?: Octokit;
  owner: string;
  repo: string;
}): Promise<ViewRendererDefinitionFile[]> {
  void octokit;
  return listViewRendererDefinitionsForTenant(`${owner}/${repo}`);
}

export async function listViewRendererDefinitionsForTenant(
  tenantId: string,
): Promise<ViewRendererDefinitionFile[]> {
  const rows = (await createBackendClient().query(api.viewRenderers.list, {
    tenantId,
  })) as Array<{ definition: ViewRendererDefinition; updatedAt?: string }>;
  const repoFiles = rows.map((row) => ({
    definition: row.definition,
    source: "repo" as const,
    sha: row.updatedAt ?? "convex",
    htmlUrl: "",
  }));
  // Built-ins fill the gaps; a repo file with the same slug overrides its
  // built-in.
  const repoSlugs = new Set(repoFiles.map((file) => file.definition.slug));
  const builtins = BUILTIN_VIEW_RENDERER_DEFINITIONS.filter(
    (definition) => !repoSlugs.has(definition.slug),
  ).map(builtinDefinitionFile);
  return [...repoFiles, ...builtins];
}

export async function writeViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  definition,
  sha,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  definition: ViewRendererDefinition;
  sha?: string;
  message: string;
}): Promise<ViewRendererDefinitionFile> {
  void octokit;
  void sha;
  void message;
  const updatedAt = new Date().toISOString();
  const savedVersion = await createBackendClient().mutation(
    api.viewRenderers.save,
    {
      tenantId: `${owner}/${repo}`,
      slug: definition.slug,
      definition,
      updatedAt,
    },
  );
  const version =
    typeof savedVersion === "number"
      ? savedVersion
      : viewRendererDefinitionVersion(definition);
  return {
    definition: { ...definition, version },
    source: "repo",
    sha: updatedAt,
    htmlUrl: "",
  };
}

export async function deleteViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  slug,
  sha,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  slug: string;
  sha: string;
  message: string;
}): Promise<void> {
  void octokit;
  void sha;
  void message;
  await createBackendClient().mutation(api.viewRenderers.remove, {
    tenantId: `${owner}/${repo}`,
    slug,
  });
}
