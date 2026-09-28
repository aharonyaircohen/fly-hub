/**
 * @fileoverview Integration tests for GET /api/kody/activity and
 *   GET /api/kody/activity/feed.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  getRequestAuth: vi.fn(
    () => ({ owner: "owner", repo: "repo", token: "tok" }) as unknown,
  ),
  fetchWorkflowRuns: vi.fn(async () => [] as unknown[]),
  fetchIssues: vi.fn(async () => [] as unknown[]),
  buildActivitySnapshot: vi.fn(() => ({ snapshot: true })),
  mapRunActions: vi.fn(() => new Map()),
  mapRunIssueNumbers: vi.fn(() => new Map()),
  readFeedEntries: vi.fn(async () => [] as unknown[]),
  buildFeedSnapshot: vi.fn(() => ({ feed: true })),
  backendQuery: vi.fn(async () => ({ runs: [], computedAt: "now" })),
  handleKodyApiError: vi.fn(),
}));

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: mocks.backendQuery }),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoReadAccess: (...a: unknown[]) =>
    mocks.requireKodyAuth(...(a as [])),
  verifyRepoWriteAccess: (...a: unknown[]) =>
    mocks.requireKodyAuth(...(a as [])),
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  getRequestAuth: (...a: unknown[]) => mocks.getRequestAuth(...(a as [])),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  fetchWorkflowRuns: (...a: unknown[]) => mocks.fetchWorkflowRuns(...(a as [])),
  fetchIssues: (...a: unknown[]) => mocks.fetchIssues(...(a as [])),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/activity/snapshot", () => ({
  buildActivitySnapshot: (...a: unknown[]) =>
    mocks.buildActivitySnapshot(...(a as [])),
}));

vi.mock("@dashboard/lib/activity/action", () => ({
  mapRunActions: (...a: unknown[]) => mocks.mapRunActions(...(a as [])),
  mapRunIssueNumbers: (...a: unknown[]) =>
    mocks.mapRunIssueNumbers(...(a as [])),
}));

vi.mock("@dashboard/lib/activity/feed-source", () => ({
  readFeedEntries: (...a: unknown[]) => mocks.readFeedEntries(...(a as [])),
}));

vi.mock("@dashboard/lib/activity/feed", () => ({
  buildFeedSnapshot: (...a: unknown[]) => mocks.buildFeedSnapshot(...(a as [])),
}));

vi.mock("@dashboard/lib/github-error-handler", async () => {
  const { NextResponse: NR } = await import("next/server");
  return {
    handleKodyApiError: (...a: unknown[]) => {
      mocks.handleKodyApiError(...(a as []));
      return NR.json({ error: "handled" }, { status: 500 });
    },
  };
});

import { NextRequest, NextResponse } from "next/server";
import { GET as getActivity } from "../../app/api/kody/activity/route";
import { GET as getAgentActivity } from "../../app/api/kody/activity/agents/route";
import { GET as getFeed } from "../../app/api/kody/activity/feed/route";

const req = {} as Parameters<typeof getActivity>[0];

describe("GET /api/kody/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the activity snapshot from runs and issues", async () => {
    const runs = [{ id: 1 }];
    const issues = [{ number: 2 }];
    mocks.fetchWorkflowRuns.mockResolvedValueOnce(runs);
    mocks.fetchIssues.mockResolvedValueOnce(issues);

    const res = await getActivity(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ snapshot: true });
    expect(mocks.fetchWorkflowRuns).toHaveBeenCalledWith({ perPage: 100 });
    expect(mocks.fetchIssues).toHaveBeenCalledWith({
      state: "open",
      perPage: 100,
    });
    expect(mocks.mapRunActions).toHaveBeenCalledWith(runs, issues);
    expect(mocks.buildActivitySnapshot).toHaveBeenCalledWith(
      runs,
      expect.any(Number),
      expect.any(Map),
      expect.any(Map),
    );
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await getActivity(req);
    expect(res.status).toBe(401);
    expect(mocks.fetchWorkflowRuns).not.toHaveBeenCalled();
  });

  it("delegates failures to handleKodyApiError", async () => {
    const err = new Error("boom");
    mocks.fetchWorkflowRuns.mockRejectedValueOnce(err);
    const res = await getActivity(req);
    expect(res.status).toBe(500);
    expect(mocks.handleKodyApiError).toHaveBeenCalledWith(err, "activity");
  });
});

describe("GET /api/kody/activity/feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestAuth.mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "tok",
    });
  });

  it("returns the feed snapshot built from the backend entries", async () => {
    const entries = [{ sessionId: "s1" }];
    mocks.readFeedEntries.mockResolvedValueOnce(entries);

    const res = await getFeed(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ feed: true });
    expect(mocks.readFeedEntries).toHaveBeenCalledWith("owner", "repo", "tok");
    expect(mocks.buildFeedSnapshot).toHaveBeenCalledWith(entries);
  });

  it("returns an empty feed when repo auth headers are missing", async () => {
    mocks.getRequestAuth.mockReturnValueOnce(null);
    const res = await getFeed(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.events).toEqual([]);
    expect(json.total).toBe(0);
    expect(mocks.readFeedEntries).not.toHaveBeenCalled();
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await getFeed(req);
    expect(res.status).toBe(401);
  });

  it("delegates failures to handleKodyApiError", async () => {
    const err = new Error("read failed");
    mocks.readFeedEntries.mockRejectedValueOnce(err);
    const res = await getFeed(req);
    expect(res.status).toBe(500);
    expect(mocks.handleKodyApiError).toHaveBeenCalledWith(err, "activity-feed");
  });
});

describe("GET /api/kody/activity/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestAuth.mockReturnValue({
      owner: "owner",
      repo: "repo",
      token: "tok",
    });
    mocks.backendQuery.mockResolvedValue({ runs: [], computedAt: "now" });
  });

  it("returns only the active repository's inspectable agent runs", async () => {
    const res = await getAgentActivity(
      new NextRequest("https://dash.test/api/kody/activity/agents?limit=25"),
    );
    expect(res.status).toBe(200);
    expect(mocks.backendQuery).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "owner/repo",
      limit: 25,
      now: expect.any(String),
    });
  });

  it("adds safe approval and workflow links to the related agent run", async () => {
    mocks.backendQuery
      .mockResolvedValueOnce({
        runs: [
          {
            runId: "agent-run-1",
            workRecordId: "work-1",
            calls: [],
          },
        ],
        computedAt: "now",
      } as never)
      .mockResolvedValueOnce([
        {
          requestId: "request-1",
          workRecordId: "work-1",
          targetKind: "workflow",
          workflowId: "quality-run",
          runId: "workflow-run-1",
          mode: "start",
          status: "dispatched",
          input: { privatePrompt: "hidden" },
          approvalToken: "hidden-token",
          result: {
            secret: "hidden-result",
            execution: {
              status: "success",
              githubRunId: "42",
              completedAt: "2026-09-02T10:04:00.000Z",
            },
          },
          actor: { tokenId: "hidden-actor-token" },
          createdAt: "2026-09-02T10:01:00.000Z",
          decidedAt: "2026-09-02T10:02:00.000Z",
          decidedBy: "octocat",
          updatedAt: "2026-09-02T10:03:00.000Z",
        },
      ] as never);

    const res = await getAgentActivity(
      new NextRequest("https://dash.test/api/kody/activity/agents"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.runs[0].approvals).toEqual([
      {
        requestId: "request-1",
        workRecordId: "work-1",
        targetKind: "workflow",
        workflowId: "quality-run",
        executionRunId: "workflow-run-1",
        mode: "start",
        status: "dispatched",
        createdAt: "2026-09-02T10:01:00.000Z",
        decidedAt: "2026-09-02T10:02:00.000Z",
        decidedBy: "octocat",
        updatedAt: "2026-09-02T10:03:00.000Z",
        execution: {
          status: "done",
          updatedAt: "2026-09-02T10:04:00.000Z",
          url: "https://github.com/owner/repo/actions/runs/42",
        },
      },
    ]);
    expect(JSON.stringify(json)).not.toMatch(
      /privatePrompt|hidden-token|hidden-result|hidden-actor-token/,
    );
  });

  it("shows synchronous online automation as completed", async () => {
    mocks.backendQuery
      .mockResolvedValueOnce({
        runs: [
          {
            runId: "agent-run-automation",
            workRecordId: "work-automation",
            calls: [],
          },
        ],
        computedAt: "now",
      } as never)
      .mockResolvedValueOnce([
        {
          requestId: "request-automation",
          workRecordId: "work-automation",
          targetKind: "automation",
          workflowId: "release-alerts",
          runId: "automation-run-1",
          mode: "start",
          status: "dispatched",
          result: {
            execution: "kody-online",
            automationId: "release-alerts",
            automationKind: "notification-rule",
            operation: "created",
          },
          createdAt: "2026-09-02T10:01:00.000Z",
          decidedAt: "2026-09-02T10:02:00.000Z",
          decidedBy: "octocat",
          updatedAt: "2026-09-02T10:03:00.000Z",
        },
      ] as never);

    const res = await getAgentActivity(
      new NextRequest("https://dash.test/api/kody/activity/agents"),
    );
    const json = await res.json();

    expect(json.runs[0].approvals[0].execution).toEqual({
      status: "done",
      updatedAt: "2026-09-02T10:03:00.000Z",
    });
  });

  it("requires repository authentication", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await getAgentActivity(
      new NextRequest("https://dash.test/api/kody/activity/agents"),
    );
    expect(res.status).toBe(401);
    expect(mocks.backendQuery).not.toHaveBeenCalled();
  });
});
