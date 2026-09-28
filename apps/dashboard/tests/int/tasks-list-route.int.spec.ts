/**
 * @fileoverview Integration tests for GET/POST /api/kody/tasks.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  getRequestAuth: vi.fn(() => null as unknown),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: vi.fn(async () => null),
  fetchIssues: vi.fn(async () => [] as unknown[]),
  fetchWorkflowRuns: vi.fn(async () => [] as unknown[]),
  fetchOpenPRs: vi.fn(async () => [] as unknown[]),
  fetchKodyState: vi.fn(async () => null),
  createIssue: vi.fn(async () => ({
    number: 42,
    title: "New task",
    html_url: "https://github.test/issues/42",
  })),
  postComment: vi.fn(async () => undefined),
  uploadIssueAttachment: vi.fn(async () => ({
    name: "a.png",
    attachment_url: "https://github.test/a.png",
  })),
}));

vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  getRequestAuth: (...a: unknown[]) => mocks.getRequestAuth(...(a as [])),
  verifyActorLogin: (...a: unknown[]) => mocks.verifyActorLogin(...(a as [])),
  getUserOctokit: (...a: unknown[]) => mocks.getUserOctokit(...(a as [])),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  fetchIssues: (...a: unknown[]) => mocks.fetchIssues(...(a as [])),
  fetchWorkflowRuns: (...a: unknown[]) => mocks.fetchWorkflowRuns(...(a as [])),
  fetchOpenPRs: (...a: unknown[]) => mocks.fetchOpenPRs(...(a as [])),
  fetchDeploymentPreviews: vi.fn(async () => new Map()),
  findBranchesByIssueNumbers: vi.fn(async () => new Map()),
  getStatusFromBranch: vi.fn(async () => null),
  findStatusOnBranch: vi.fn(async () => null),
  createIssue: (...a: unknown[]) => mocks.createIssue(...(a as [])),
  uploadIssueAttachment: (...a: unknown[]) =>
    mocks.uploadIssueAttachment(...(a as [])),
  postComment: (...a: unknown[]) => mocks.postComment(...(a as [])),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  fetchKodyState: (...a: unknown[]) => mocks.fetchKodyState(...(a as [])),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

vi.mock("@kody-ade/fly/previews/config", () => ({
  resolvePreviewConfigForOctokit: vi.fn(async () => null),
}));

vi.mock("@kody-ade/fly/preview-token", () => ({
  mintPreviewTicket: vi.fn(() => ({ ticket: "ticket" })),
}));

vi.mock("@dashboard/lib/tasks/preview-urls", () => ({
  buildPreviewUrlByPrNumber: vi.fn(async () => new Map()),
}));

vi.mock("@dashboard/lib/workflow-matching", () => ({
  matchWorkflowRunToTask: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/tasks/derive-column", () => ({
  deriveTaskColumn: vi.fn(() => "building"),
}));

vi.mock("@dashboard/lib/tasks/visibility", () => ({
  isDashboardIntakeIssue: vi.fn(() => true),
  isDashboardKodyOwnedIssue: vi.fn(() => true),
  isDashboardUnassignedIssue: vi.fn(() => true),
}));

import { NextResponse } from "next/server";
import { GET, POST } from "../../app/api/kody/tasks/route";

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "Fix the login flow",
    body: "",
    state: "open",
    labels: [] as { name: string }[],
    assignees: [] as string[],
    isKodyAssigned: true,
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
    ...overrides,
  };
}

function getReq(qs = "") {
  return {
    url: `http://localhost/api/kody/tasks${qs}`,
  } as unknown as Parameters<typeof GET>[0];
}

function postReq(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

describe("GET /api/kody/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped tasks with counts", async () => {
    mocks.fetchIssues.mockResolvedValueOnce([makeIssue()]);

    const res = await GET(getReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0]).toMatchObject({
      issueNumber: 7,
      title: "Fix the login flow",
      column: "building",
    });
    expect(json.counts).toEqual({ running: 1, backlog: 0, history: 0 });
    expect(json.pagination).toBeUndefined();
  });

  it("drops terminal/backlog tasks for view=running and pages history", async () => {
    mocks.fetchIssues.mockResolvedValue([makeIssue()]);

    const res = await GET(getReq("?view=running"));
    const json = await res.json();
    expect(json.tasks).toHaveLength(1);

    const res2 = await GET(getReq("?view=history&page=1&perPage=5"));
    const json2 = await res2.json();
    // column mocked as "building" → not history
    expect(json2.tasks).toHaveLength(0);
    expect(json2.pagination).toMatchObject({ page: 1, perPage: 5, total: 0 });
    mocks.fetchIssues.mockReset();
    mocks.fetchIssues.mockResolvedValue([]);
  });

  it("filters by search query and status", async () => {
    mocks.fetchIssues.mockResolvedValueOnce([
      makeIssue({ number: 1, title: "alpha" }),
      makeIssue({ number: 2, title: "beta" }),
    ]);

    const res = await GET(getReq("?q=beta"));
    const json = await res.json();
    expect(json.tasks.map((t: { title: string }) => t.title)).toEqual(["beta"]);
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "Not authenticated" }, { status: 401 }),
    );
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("maps GitHub rate limiting to 429", async () => {
    mocks.fetchIssues.mockRejectedValueOnce(
      Object.assign(new Error("API rate limit exceeded"), { status: 403 }),
    );
    const res = await GET(getReq());
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(json.error).toBe("rate_limited");
  });

  it("maps missing-token errors to 401 no_token", async () => {
    mocks.fetchIssues.mockRejectedValueOnce(
      new Error("Neither KODY_BOT_TOKEN nor GITHUB_TOKEN is configured"),
    );
    const res = await GET(getReq());
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("no_token");
  });

  it("returns empty tasks with error message for other failures", async () => {
    mocks.fetchIssues.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(getReq());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.tasks).toEqual([]);
    expect(json.error).toBe("boom");
  });
});

describe("POST /api/kody/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an issue, defaults assignee to actor, and auto-triggers @kody", async () => {
    const res = await POST(
      postReq({ title: "New task", body: "details", actorLogin: "tester" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.issue).toMatchObject({ number: 42, title: "New task" });
    expect(mocks.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New task", assignees: ["tester"] }),
      undefined,
    );
    expect(mocks.postComment).toHaveBeenCalledWith(42, "@kody", undefined);
  });

  it("skips the @kody trigger when autoTrigger=false", async () => {
    const res = await POST(postReq({ title: "Anchor", autoTrigger: false }));
    expect(res.status).toBe(200);
    expect(mocks.postComment).not.toHaveBeenCalled();
  });

  it("rejects invalid bodies with 400 validation error", async () => {
    const res = await POST(postReq({ title: "" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation error");
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("uploads attachments and reports them", async () => {
    const res = await POST(
      postReq({
        title: "With file",
        attachments: [{ name: "a.png", content: "base64" }],
      }),
    );
    const json = await res.json();
    expect(json.attachments).toHaveLength(1);
    expect(mocks.uploadIssueAttachment).toHaveBeenCalledOnce();
  });

  it("maps expired GitHub tokens to 401", async () => {
    mocks.createIssue.mockRejectedValueOnce(
      Object.assign(new Error("Bad credentials"), { status: 401 }),
    );
    const res = await POST(postReq({ title: "x" }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("github_token_expired");
  });

  it("returns 500 for unexpected failures", async () => {
    mocks.createIssue.mockRejectedValueOnce(new Error("kaput"));
    const res = await POST(postReq({ title: "x" }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to create task");
    expect(json.details).toBe("kaput");
  });
});
