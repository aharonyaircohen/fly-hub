/**
 * @fileType utility
 * @domain kody
 * @pattern instructions-files
 * @ai-summary Read/write the per-repo user instructions document stored in
 *   the Convex backend (repoDocs, kind "instructions", doc `{ body }`).
 *   This is a single free-form markdown doc (no frontmatter) appended to
 *   every kody-direct chat turn under "## User instructions for this repo" —
 *   the user's place to put tone, length, formatting, or behavioral
 *   preferences that override the base agent prompt. Voice overlay still
 *   wins over this block (applied after buildSystemPrompt in route.ts) so
 *   TTS output shape stays correct on the mic. Returned `sha` is always "".
 *
 *   Cache mirrors the memory-index pattern: 60s in-process per repo,
 *   invalidated by the PUT/DELETE routes.
 */

import { getOwner, getRepo } from "../github";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@kody-ade/base/backend/convex";

const INSTRUCTIONS_PATH = "instructions.md";
const INSTRUCTIONS_KIND = "instructions";

export interface InstructionsFile {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

interface InstructionsDocRecord {
  doc: { body?: unknown };
  updatedAt: string;
}

export async function readInstructionsFile(): Promise<InstructionsFile | null> {
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: INSTRUCTIONS_KIND,
  })) as InstructionsDocRecord | null;
  if (!record || typeof record.doc?.body !== "string") return null;
  return {
    body: record.doc.body,
    sha: "",
    updatedAt: record.updatedAt,
    htmlUrl: "",
  };
}

interface WriteOptions {
  body: string;
}

export async function writeInstructionsFile(
  opts: WriteOptions,
): Promise<InstructionsFile> {
  const body = opts.body.endsWith("\n") ? opts.body : `${opts.body}\n`;
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: INSTRUCTIONS_KIND,
    doc: { body },
    updatedAt,
  });
  invalidateInstructionsPromptCache();
  return { body, sha: "", updatedAt, htmlUrl: "" };
}

export async function deleteInstructionsFile(): Promise<void> {
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: INSTRUCTIONS_KIND,
  });
  invalidateInstructionsPromptCache();
}

interface CachedInstructions {
  body: string;
  expiresAt: number;
}
const cache = new Map<string, CachedInstructions>();
const CACHE_TTL_MS = 60_000;

function cacheKey(): string {
  return `${getOwner()}/${getRepo()}`;
}

/**
 * Load the user instructions for the current request's repo with a 60-second
 * in-process cache (same TTL as the memory-index loader). Returns `null` when
 * the doc is absent or empty — callers should treat that as "no overlay".
 */
export async function loadInstructionsForPrompt(): Promise<string | null> {
  const key = cacheKey();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.body || null;
  }
  const result = await readInstructionsFile();
  const body = (result?.body ?? "").trim();
  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
  return body || null;
}

export function invalidateInstructionsPromptCache(): void {
  cache.delete(cacheKey());
}

export { INSTRUCTIONS_PATH };
