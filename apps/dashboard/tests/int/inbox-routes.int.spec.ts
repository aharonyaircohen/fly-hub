/**
 * @fileoverview Integration tests for /api/kody/inbox (GET/POST) and
 *   GET /api/kody/inbox/feed.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  getRequestAuth: vi.fn(
    () => ({ owner: "owner", repo: "repo", token: "tok" }) as unknown,
  ),
  getUserOctokit: vi.fn(async () => ({}) as unknown),
  readInbox: vi.fn(async () => ({
    gistId: "g1",
    manifest: { entries: [] as unknown[] },
  })),
  appendInboxEntries: vi.fn(async () => ({
    added: 1,
    manifest: { entries: [] as unknown[] },
  })),
  readInboxFeed: vi.fn(async () => ({ entries: [] as unknown[] })),
  getAuthenticated: vi.fn(async () => ({ data: { login: "Tester" } })),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  getRequestAuth: (...a: unknown[]) => mocks.getRequestAuth(...(a as [])),
  getUserOctokit: (...a: unknown[]) => mocks.getUserOctokit(...(a as [])),
}));

vi.mock("@dashboard/lib/inbox/convex-store", () => ({
  readInbox: (...a: unknown[]) => mocks.readInbox(...(a as [])),
  appendInboxEntries: (...a: unknown[]) =>
    mocks.appendInboxEntries(...(a as [])),
}));

vi.mock("@dashboard/lib/inbox/feed-server", () => ({
  readInboxFeedForTenant: (...a: unknown[]) =>
    mocks.readInboxFeed(...(a as [])),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

import { NextResponse } from "next/server";
import {
  GET as getInbox,
  POST as postInbox,
} from "../../app/api/kody/inbox/route";
import { GET as getInboxFeed } from "../../app/api/kody/inbox/feed/route";

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    source: "mention",
    repoFullName: "owner/repo",
    threadType: "issue",
    title: "You were mentioned",
    snippet: "@tester take a look",
    author: "alice",
    url: "https://github.test/owner/repo/issues/1",
    sentAt: "2026-07-16T10:00:00Z",
    readAt: null,
    ...overrides,
  };
}

const getReq = {} as Parameters<typeof getInbox>[0];
const jsonReq = (body?: unknown) =>
  ({
    json: async () => {
      if (body === undefined) throw new Error("bad json");
      return body;
    },
  }) as unknown as Parameters<typeof postInbox>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestAuth.mockReturnValue({
    owner: "owner",
    repo: "repo",
    token: "tok",
  });
  mocks.getUserOctokit.mockResolvedValue({
    rest: {
      users: {
        getAuthenticated: (...a: unknown[]) =>
          mocks.getAuthenticated(...(a as [])),
      },
    },
  });
  mocks.getAuthenticated.mockResolvedValue({ data: { login: "Tester" } });
});

describe("GET /api/kody/inbox", () => {
  it("returns the gist-backed inbox entries with no-store caching", async () => {
    const entries = [validEntry()];
    mocks.readInbox.mockResolvedValueOnce({
      gistId: "g1",
      manifest: { entries },
    });

    const res = await getInbox(getReq);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.gistId).toBe("g1");
    expect(json.entries).toHaveLength(1);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readInbox).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
    );
  });

  it("returns 401 without repo auth headers", async () => {
    mocks.getRequestAuth.mockReturnValueOnce(null);
    const res = await getInbox(getReq);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("auth_required");
  });

  it("returns 401 when no user octokit can be built", async () => {
    mocks.getUserOctokit.mockResolvedValueOnce(null);
    const res = await getInbox(getReq);
    expect(res.status).toBe(401);
  });

  it("surfaces a missing gist scope as a 400 hint", async () => {
    mocks.readInbox.mockRejectedValueOnce(
      Object.assign(new Error("Not Found — gist read failed"), {
        status: 404,
      }),
    );
    const res = await getInbox(getReq);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("gist_scope_missing");
  });

  it("returns 500 for other read failures", async () => {
    mocks.readInbox.mockRejectedValueOnce(new Error("network down"));
    const res = await getInbox(getReq);
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("read_failed");
    expect(json.message).toBe("network down");
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await getInbox(getReq);
    expect(res.status).toBe(401);
    expect(mocks.readInbox).not.toHaveBeenCalled();
  });
});

describe("POST /api/kody/inbox", () => {
  it("appends validated entries", async () => {
    const entries = [validEntry()];
    mocks.appendInboxEntries.mockResolvedValueOnce({
      added: 1,
      manifest: { entries },
    });

    const res = await postInbox(jsonReq({ entries }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.added).toBe(1);
    expect(mocks.appendInboxEntries).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      entries,
    );
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await postInbox(jsonReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_json");
  });

  it("rejects invalid entry payloads with 400 validation", async () => {
    const res = await postInbox(
      jsonReq({ entries: [validEntry({ url: "not-a-url" })] }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("validation");
    expect(mocks.appendInboxEntries).not.toHaveBeenCalled();
  });

  it("rejects an empty entries array", async () => {
    const res = await postInbox(jsonReq({ entries: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when the append fails", async () => {
    mocks.appendInboxEntries.mockRejectedValueOnce(new Error("cas conflict"));
    const res = await postInbox(jsonReq({ entries: [validEntry()] }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("append_failed");
  });
});

describe("GET /api/kody/inbox/feed", () => {
  function feedReq(since?: string) {
    return {
      nextUrl: {
        searchParams: new URLSearchParams(since ? { since } : {}),
      },
    } as unknown as Parameters<typeof getInboxFeed>[0];
  }

  function feedEntry(overrides: Record<string, unknown> = {}) {
    return {
      login: "tester",
      sentAt: "2026-07-16T12:00:00Z",
      title: "ping",
      ...overrides,
    };
  }

  it("returns only the caller's entries newer than the cursor", async () => {
    mocks.readInboxFeed.mockResolvedValueOnce({
      entries: [
        feedEntry({ title: "mine-new" }),
        feedEntry({ title: "mine-old", sentAt: "2026-07-15T12:00:00Z" }),
        feedEntry({ title: "not-mine", login: "someone-else" }),
      ],
    });

    const res = await getInboxFeed(feedReq("2026-07-16T00:00:00Z"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.login).toBe("tester");
    expect(json.entries.map((e: { title: string }) => e.title)).toEqual([
      "mine-new",
    ]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns everything for the user when no cursor is given", async () => {
    mocks.readInboxFeed.mockResolvedValueOnce({
      entries: [
        feedEntry({ title: "a" }),
        feedEntry({ title: "b", sentAt: "2020-01-01T00:00:00Z" }),
      ],
    });
    const res = await getInboxFeed(feedReq());
    const json = await res.json();
    expect(json.entries).toHaveLength(2);
  });

  it("returns 401 when the GitHub login cannot be resolved", async () => {
    mocks.getAuthenticated.mockRejectedValueOnce(new Error("bad token"));
    const res = await getInboxFeed(feedReq());
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.message).toBe("Could not resolve GitHub login");
  });

  it("returns 401 without repo auth headers", async () => {
    mocks.getRequestAuth.mockReturnValueOnce(null);
    const res = await getInboxFeed(feedReq());
    expect(res.status).toBe(401);
  });

  it("returns 500 when the feed manifest read fails", async () => {
    mocks.readInboxFeed.mockRejectedValueOnce(new Error("backend gone"));
    const res = await getInboxFeed(feedReq());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("read_failed");
  });
});
