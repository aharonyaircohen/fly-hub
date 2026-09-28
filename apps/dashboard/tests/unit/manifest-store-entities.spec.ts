import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: Array<{ login: string; entry: any }> = [];
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: { inbox: { listByTenant: "list", upsert: "upsert" } },
  tenantIdFor: (owner: string, repo: string) => `${owner}/${repo}`,
  getConvexClient: () => ({
    query: vi.fn(async (_fn: unknown, args: { tenantId: string }) => rows.filter((row) => row.entry.repoFullName === args.tenantId)),
    mutation: vi.fn(async (_fn: unknown, args: any) => { if (!rows.some((row) => row.entry.id === args.entryId)) rows.push({ login: args.login, entry: args.entry }); }),
  }),
}));

import { appendInboxFeed } from "@dashboard/lib/inbox/feed-server";
import type { InboxFeedEntry } from "@dashboard/lib/inbox/feed";

function entry(over: Partial<InboxFeedEntry>): InboxFeedEntry {
  return {
    id: over.id ?? "u:1", login: over.login ?? "u", source: over.source ?? ("mention" as InboxFeedEntry["source"]),
    repoFullName: over.repoFullName ?? "acme/widgets", threadType: "Issue", title: "t", snippet: "s",
    url: over.url ?? "https://x/1", sentAt: over.sentAt ?? "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => { rows.length = 0; });

describe("inbox-feed Convex storage", () => {
  it("dedupes entries", async () => {
    expect(await appendInboxFeed([entry({ id: "u:1" }), entry({ id: "u:1" })])).toBe(1);
  });
  it("accepts empty input", async () => { expect(await appendInboxFeed([])).toBe(0); });
});
