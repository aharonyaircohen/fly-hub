/**
 * @fileType util
 * @domain kody
 * @pattern context-files
 * @ai-summary Read/write context entries in the Convex backend (repoDocs,
 *   kind `context:<slug>`, doc `{ body }` where body is the full markdown
 *   INCLUDING the `agent:` frontmatter block — the same text the Convex
 *   file used to hold, so the export/import mapping round-trips unchanged).
 *   The slug is the entry name (e.g. `company-profile`, `mission`) and the
 *   body is free-form markdown — curated context you write FOR Kody.
 *
 *   Each body may carry a tiny YAML frontmatter block with a single
 *   `agent:` field — an inline list (`[kody, qa-engineer]`) of the
 *   agent-member slugs that own the entry. Legacy bodies use `audience:` or
 *   have NO frontmatter; both are mapped on read (`chat` → `kody`,
 *   `qa` → `qa-engineer`, frontmatter-less → `[kody]`) so existing data
 *   keeps flowing unchanged (see `context/frontmatter.ts`).
 *
 *   Entries owned by the built-in chat agent (`kody`) are injected into the
 *   kody-direct chat system prompt under a `## Context` heading (see
 *   `loadContextForPrompt`). Returned `sha` is always "" (Convex docs have
 *   no git blob).
 *
 *   Hot-path loader keeps the 60s in-process per-repo cache, invalidated by
 *   the write/delete paths.
 */

import { getOwner, getRepo } from "../github";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@kody-ade/base/backend/convex";
import {
  splitContextFrontmatter,
  joinContextFrontmatter,
  KODY_CHAT_AGENT,
  ALL_AGENT,
} from "./frontmatter";

const CONTEXT_DIR = "context";
const CONTEXT_KIND_PREFIX = "context:";

export interface ContextFile {
  /** Filename without `.md` — stable identity, also the entry heading. */
  slug: string;
  /**
   * Free-form markdown body. Frontmatter is stripped — this is the entry
   * text only.
   */
  body: string;
  /**
   * Agent-member slugs that own this entry, from `agent:` frontmatter.
   * Defaults to `["kody"]` (the built-in chat agent) for legacy
   * frontmatter-less files. Always non-empty unless explicitly unassigned.
   */
  agent: string[];
  /** Git blob sha — always "" on the Convex backend. Kept for API shape. */
  sha: string;
  /** Last write timestamp. */
  updatedAt: string;
  /** Convenience link — always "" on the Convex backend. */
  htmlUrl: string;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

interface ContextDocRecord {
  kind: string;
  doc: { body?: unknown };
  updatedAt: string;
}

function contextKind(slug: string): string {
  return `${CONTEXT_KIND_PREFIX}${slug}`;
}

function recordToContextFile(record: ContextDocRecord): ContextFile | null {
  const slug = record.kind.slice(CONTEXT_KIND_PREFIX.length);
  if (!isValidSlug(slug)) return null;
  if (typeof record.doc?.body !== "string") return null;
  const raw = record.doc.body.replace(/^\s+/, "");
  const { frontmatter, body } = splitContextFrontmatter(raw);
  return {
    slug,
    body: body.replace(/^\s+/, ""),
    agent: frontmatter.agent,
    sha: "",
    updatedAt: record.updatedAt,
    htmlUrl: "",
  };
}

/**
 * List every context entry (repoDocs kind `context:*`). Returns `[]` when
 * none exist. Sorted by slug for a stable UI order.
 */
export async function listContextFiles(): Promise<ContextFile[]> {
  const records = (await getConvexClient().query(
    backendApi.repoDocs.listByPrefix,
    {
      tenantId: tenantIdFor(getOwner(), getRepo()),
      prefix: CONTEXT_KIND_PREFIX,
    },
  )) as ContextDocRecord[];
  return records
    .map(recordToContextFile)
    .filter((f): f is ContextFile => f !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function readContextFile(
  slug: string,
): Promise<ContextFile | null> {
  if (!isValidSlug(slug)) return null;
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: contextKind(slug),
  })) as ContextDocRecord | null;
  if (!record) return null;
  return recordToContextFile(record);
}

interface WriteOptions {
  slug: string;
  /** Entry markdown (frontmatter-free); the `agent:` block is re-attached here. */
  body: string;
  /** Owning agent-member slugs persisted in `agent:` frontmatter (inline list). */
  agent: string[];
}

export async function writeContextFile(
  opts: WriteOptions,
): Promise<ContextFile> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid context slug: "${opts.slug}". Use lowercase letters, digits, dashes, underscores.`,
    );
  }
  const withFrontmatter = joinContextFrontmatter(
    { agent: opts.agent },
    opts.body,
  );
  const content = withFrontmatter.endsWith("\n")
    ? withFrontmatter
    : `${withFrontmatter}\n`;
  const updatedAt = new Date().toISOString();

  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: contextKind(opts.slug),
    doc: { body: content },
    updatedAt,
  });
  invalidateContextPromptCache();

  const refreshed = recordToContextFile({
    kind: contextKind(opts.slug),
    doc: { body: content },
    updatedAt,
  });
  if (!refreshed) {
    throw new Error(
      "writeContextFile: entry was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteContextFile(slug: string): Promise<void> {
  if (!isValidSlug(slug)) throw new Error(`Invalid context slug: "${slug}".`);
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: contextKind(slug),
  });
  invalidateContextPromptCache();
}
// ─── Hot-path loader (chat system prompt) ──────────────────────────────────

interface CachedContext {
  prompt: string;
  expiresAt: number;
}
const cache = new Map<string, CachedContext>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Concatenate the chat-agent context entries into a single markdown block for
 * the chat system prompt, each entry prefixed with its slug as a `###`
 * heading. Only entries owned by the built-in chat agent (`kody`) or the `*`
 * all-agent wildcard are included — entries attached only to other agent
 * (e.g. `qa-engineer`) are skipped so they never reach the chat prompt.
 * Returns `null` when no such entries exist. 60s in-process cache (same TTL
 * as the instructions loader); callers treat `null` as "no context".
 */
export async function loadContextForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prompt || null;
  }
  const files = await listContextFiles();
  const prompt = files
    .filter(
      (f) => f.agent.includes(KODY_CHAT_AGENT) || f.agent.includes(ALL_AGENT),
    )
    .map((f) => `### ${f.slug}\n\n${f.body.trim()}`)
    .join("\n\n")
    .trim();
  cache.set(key, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
  return prompt || null;
}

export function invalidateContextPromptCache(): void {
  cache.delete(cacheKey());
}

export { CONTEXT_DIR };
