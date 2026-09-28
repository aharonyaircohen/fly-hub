import "server-only";
import { backendApi, getConvexClient, tenantIdFor } from "../backend/convex-backend";
import { capFeedEntries, type InboxFeedEntry, type InboxFeedManifest } from "./feed";
import type { InboxEntry } from "./types";

function tenantFromEntries(entries: InboxFeedEntry[]): string {
  const repo = entries[0]?.repoFullName;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error("Inbox feed entries require repoFullName");
  return tenantIdFor(...repo.split("/") as [string, string]);
}

function toInboxEntry(entry: InboxFeedEntry): InboxEntry {
  // `login` is routing metadata (stored as its own column) — the entry
  // validator rejects it as an extra field inside the document.
  const { login: _login, ...rest } = entry;
  return { ...rest, readAt: null };
}

export async function readInboxFeed(): Promise<InboxFeedManifest> {
  throw new Error("readInboxFeed requires a tenant-specific inbox read");
}

export async function readInboxFeedForTenant(owner: string, repo: string): Promise<InboxFeedManifest> {
  const rows = await getConvexClient().query(backendApi.inbox.listByTenant, { tenantId: tenantIdFor(owner, repo) });
  return { version: 1, entries: (rows as Array<{ login: string; entry: Omit<InboxFeedEntry, "login"> }>).map((row) => ({ ...row.entry, login: row.login })) };
}

export async function appendInboxFeed(incoming: InboxFeedEntry[]): Promise<number> {
  if (incoming.length === 0) return 0;
  const tenantId = tenantFromEntries(incoming);
  const existing = await getConvexClient().query(backendApi.inbox.listByTenant, { tenantId });
  const seen = new Set((existing as Array<{ entry: InboxEntry }>).map((row) => row.entry.id));
  const batchSeen = new Set<string>();
  const fresh = incoming.filter((entry) => {
    if (seen.has(entry.id) || batchSeen.has(entry.id)) return false;
    batchSeen.add(entry.id);
    return true;
  });
  await Promise.all(fresh.map((entry) => getConvexClient().mutation(backendApi.inbox.upsert, {
    tenantId, login: entry.login.toLowerCase(), entryId: entry.id, entry: toInboxEntry(entry), sentAt: entry.sentAt,
  })));
  return fresh.length;
}
