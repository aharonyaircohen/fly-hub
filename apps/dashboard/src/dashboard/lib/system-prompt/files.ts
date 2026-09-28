/**
 * @fileType utility
 * @domain kody
 * @pattern system-prompt-files
 * @ai-summary Read/write the per-repo base system prompt override stored in
 *   the Convex backend (repoDocs, kind "system-prompt", doc `{ body }`).
 *   When present and non-empty, the engine (kody-live chat) uses it INSTEAD
 *   of its built-in CHAT_SYSTEM_PROMPT — unlike `instructions.md`, which is
 *   layered on top. Empty/absent doc → built-in prompt.
 */

import { getOwner, getRepo } from "../github-client";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "../backend/convex-backend";

const SYSTEM_PROMPT_PATH = "system-prompt.md";
const SYSTEM_PROMPT_KIND = "system-prompt";

export interface SystemPromptFile {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

interface SystemPromptDoc {
  doc: { body?: unknown };
  updatedAt: string;
}

export async function readSystemPromptFile(): Promise<SystemPromptFile | null> {
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: SYSTEM_PROMPT_KIND,
  })) as SystemPromptDoc | null;
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

export async function writeSystemPromptFile(
  opts: WriteOptions,
): Promise<SystemPromptFile> {
  const body = opts.body.endsWith("\n") ? opts.body : `${opts.body}\n`;
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: SYSTEM_PROMPT_KIND,
    doc: { body },
    updatedAt,
  });
  return { body, sha: "", updatedAt, htmlUrl: "" };
}

export async function deleteSystemPromptFile(): Promise<void> {
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: SYSTEM_PROMPT_KIND,
  });
}

export { SYSTEM_PROMPT_PATH };
