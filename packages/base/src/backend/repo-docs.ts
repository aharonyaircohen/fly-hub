import "server-only";

import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

function tenantId(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
function kind(path: string): string { return `runtime:${path}`; }

export async function readBackendDoc(_octokit: unknown, owner: string, repo: string, path: string, _options?: unknown) {
  const record = await createBackendClient().query(api.repoDocs.get, { tenantId: tenantId(owner, repo), kind: kind(path) });
  if (!record || !record.doc || typeof record.doc !== "object") return null;
  const content = (record.doc as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  return { path, content, sha: record.updatedAt, etag: record.updatedAt };
}

export async function writeBackendDoc(args: { octokit?: unknown; owner: string; repo: string; path: string; content: string; sha?: string; [key: string]: unknown }) {
  const updatedAt = new Date().toISOString();
  await createBackendClient().mutation(api.repoDocs.save, { tenantId: tenantId(args.owner, args.repo), kind: kind(args.path), doc: { content: args.content }, updatedAt, ...(args.sha ? { expectedUpdatedAt: args.sha } : {}) });
  return { path: args.path, content: args.content, sha: updatedAt, etag: updatedAt };
}

export async function deleteBackendDoc(args: { owner: string; repo: string; path: string; sha?: string; [key: string]: unknown }) {
  await createBackendClient().mutation(api.repoDocs.remove, { tenantId: tenantId(args.owner, args.repo), kind: kind(args.path) });
}
