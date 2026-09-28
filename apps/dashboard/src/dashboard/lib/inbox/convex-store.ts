import "server-only";
import type { Octokit } from "@octokit/rest";
import { backendApi, getConvexClient, tenantIdFor } from "../backend/convex-backend";
import { INBOX_MAX_ENTRIES, type InboxEntry, type InboxManifest } from "./types";
import { ctoFeedKey } from "./feed";

async function loginFor(octokit: Octokit): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  if (!data.login) throw new Error("GitHub login unavailable");
  return data.login.toLowerCase();
}

async function read(octokit: Octokit, owner: string, repo: string): Promise<{ login: string; manifest: InboxManifest }> {
  const login = await loginFor(octokit);
  const rows = await getConvexClient().query(backendApi.inbox.list, { tenantId: tenantIdFor(owner, repo), login });
  const entries = (rows as Array<{ entry: InboxEntry; readAt?: string; sentAt: string }>).map((row) => ({ ...row.entry, readAt: row.readAt ?? row.entry.readAt, sentAt: row.sentAt }));
  return { login, manifest: { version: 1, entries } };
}

async function write(octokit: Octokit, owner: string, repo: string, login: string, manifest: InboxManifest): Promise<void> {
  const tenantId = tenantIdFor(owner, repo);
  await Promise.all(manifest.entries.slice(0, INBOX_MAX_ENTRIES).map((entry) => getConvexClient().mutation(backendApi.inbox.upsert, {
    tenantId, login, entryId: entry.id, entry, sentAt: entry.sentAt, readAt: entry.readAt ?? undefined,
  })));
}

export async function readInbox(octokit: Octokit, owner: string, repo: string) {
  const { manifest } = await read(octokit, owner, repo);
  return { gistId: null, manifest };
}

export async function appendInboxEntries(octokit: Octokit, owner: string, repo: string, incoming: InboxEntry[]) {
  const { login, manifest } = await read(octokit, owner, repo);
  const seen = new Set(manifest.entries.map((entry) => entry.id));
  const fresh = incoming.filter((entry) => !seen.has(entry.id));
  const all = [...fresh, ...manifest.entries].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  const ctoSeen = new Set<string>();
  const entries = all.filter((entry) => { const key = ctoFeedKey(entry); if (key === null) return true; if (ctoSeen.has(key)) return false; ctoSeen.add(key); return true; }).slice(0, INBOX_MAX_ENTRIES);
  const next = { version: 1 as const, entries };
  if (fresh.length > 0 || entries.length !== manifest.entries.length) await write(octokit, owner, repo, login, next);
  return { manifest: next, added: fresh.length };
}

export async function markEntryRead(octokit: Octokit, owner: string, repo: string, entryId: string, readAt: string | null) {
  const { login, manifest } = await read(octokit, owner, repo);
  const next: InboxManifest = { version: 1, entries: manifest.entries.map((entry) => entry.id === entryId ? { ...entry, readAt } : entry) };
  await write(octokit, owner, repo, login, next);
  return next;
}

export async function markAllRead(octokit: Octokit, owner: string, repo: string) {
  const { login, manifest } = await read(octokit, owner, repo);
  const now = new Date().toISOString();
  const next = { version: 1 as const, entries: manifest.entries.map((entry) => entry.readAt ? entry : { ...entry, readAt: now }) };
  await write(octokit, owner, repo, login, next);
  return next;
}

export async function deleteEntry(octokit: Octokit, owner: string, repo: string, entryId: string) {
  const login = await loginFor(octokit);
  await getConvexClient().mutation(backendApi.inbox.remove, { tenantId: tenantIdFor(owner, repo), login, entryId });
  return (await read(octokit, owner, repo)).manifest;
}

export async function clearInbox(octokit: Octokit, owner: string, repo: string) {
  const { login, manifest } = await read(octokit, owner, repo);
  await Promise.all(manifest.entries.map((entry) => getConvexClient().mutation(backendApi.inbox.remove, {
    tenantId: tenantIdFor(owner, repo), login, entryId: entry.id,
  })));
  return { version: 1 as const, entries: [] };
}

export async function markByUrl(octokit: Octokit, owner: string, repo: string, url: string) {
  const { login, manifest } = await read(octokit, owner, repo);
  const next = { version: 1 as const, entries: manifest.entries.map((entry) => entry.url === url ? { ...entry, readAt: new Date().toISOString() } : entry) };
  await write(octokit, owner, repo, login, next);
  return next;
}
