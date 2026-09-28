/**
 * @fileoverview Integration tests for GET /api/kody/tasks/[taskId].
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  fetchIssue: vi.fn(async () => null as unknown),
  fetchIssues: vi.fn(async () => [] as unknown[]),
  fetchComments: vi.fn(async () => [] as unknown[]),
  fetchWorkflowRuns: vi.fn(async () => [] as unknown[]),
  findTaskBranch: vi.fn(async () => null),
  getStatusFromBranch: vi.fn(async () => null),
  findAssociatedPRByIssueNumber: vi.fn(
    async (): Promise<{ number: number; merged_at: string | null } | null> =>
      null,
  ),
  parseAllComments: vi.fn(() => [] as unknown[]),
  matchWorkflowRunToTask: vi.fn(() => undefined),
  findKodyStateInComments: vi.fn(() => null),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  fetchIssue: (...a: unknown[]) => mocks.fetchIssue(...(a as [])),
  fetchIssues: (...a: unknown[]) => mocks.fetchIssues(...(a as [])),
  fetchComments: (...a: unknown[]) => mocks.fetchComments(...(a as [])),
  findTaskBranch: (...a: unknown[]) => mocks.findTaskBranch(...(a as [])),
  getStatusFromBranch: (...a: unknown[]) =>
    mocks.getStatusFromBranch(...(a as [])),
  findAssociatedPRByIssueNumber: (...a: unknown[]) =>
    mocks.findAssociatedPRByIssueNumber(...(a as [])),
  fetchWorkflowRuns: (...a: unknown[]) => mocks.fetchWorkflowRuns(...(a as [])),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/task-parser", () => ({
  parseAllComments: (...a: unknown[]) => mocks.parseAllComments(...(a as [])),
}));

vi.mock("@kody-ade/base/task-comment-state", () => ({
  findKodyStateInComments: (...a: unknown[]) =>
    mocks.findKodyStateInComments(...(a as [])),
}));

vi.mock("@dashboard/lib/workflow-matching", () => ({
  matchWorkflowRunToTask: (...a: unknown[]) =>
    mocks.matchWorkflowRunToTask(...(a as [])),
}));

import { NextResponse } from "next/server";
import { GET } from "../../app/api/kody/tasks/[taskId]/route";

const req = {} as Parameters<typeof GET>[0];
const ctx = (taskId: string) => ({ params: Promise.resolve({ taskId }) });

function makeIssue(number = 12) {
  return {
    number,
    title: `Task #${number}`,
    body: "",
    state: "open",
    labels: [] as { name: string }[],
    assignees: [] as string[],
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
  };
}

function makeRawComment(id: number, body: string) {
  return {
    id,
    body,
    created_at: "2026-07-01T11:00:00Z",
    user: { login: "kody" },
  };
}

describe("GET /api/kody/tasks/[taskId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the task with comments for a numeric issue id", async () => {
    mocks.fetchIssue.mockResolvedValueOnce(makeIssue(12));
    mocks.fetchComments.mockResolvedValueOnce([makeRawComment(1, "hello")]);

    const res = await GET(req, ctx("issue-12"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.task).toMatchObject({
      issueNumber: 12,
      id: "issue-12",
      column: "open",
    });
    expect(json.comments).toEqual([
      expect.objectContaining({ id: 1, body: "hello" }),
    ]);
    expect(mocks.fetchIssue).toHaveBeenCalledWith(12);
  });

  it("derives review column when an unmerged PR is associated", async () => {
    mocks.fetchIssue.mockResolvedValueOnce(makeIssue(13));
    mocks.findAssociatedPRByIssueNumber.mockResolvedValueOnce({
      number: 99,
      merged_at: null,
    });

    const res = await GET(req, ctx("issue-13"));
    const json = await res.json();
    expect(json.task.column).toBe("review");
  });

  it("returns 404 when the issue does not exist", async () => {
    mocks.fetchIssue.mockResolvedValueOnce(null);
    const res = await GET(req, ctx("issue-999"));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toBe("Task not found");
  });

  it("finds a non-digit-leading taskId via comment task markers", async () => {
    mocks.fetchIssues.mockResolvedValueOnce([makeIssue(20)]);
    mocks.fetchComments.mockResolvedValue([makeRawComment(5, "marker")]);
    mocks.parseAllComments.mockReturnValue([
      {
        type: "task-marker",
        taskId: "auto-260701-1",
        body: "",
        createdAt: "2026-07-01T11:00:00Z",
      },
    ]);

    const res = await GET(req, ctx("auto-260701-1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.task.id).toBe("auto-260701-1");
    expect(json.task.issueNumber).toBe(20);
    mocks.parseAllComments.mockReturnValue([]);
    mocks.fetchComments.mockResolvedValue([]);
  });

  it("returns 404 when no issue carries the task marker", async () => {
    mocks.fetchIssues.mockResolvedValueOnce([makeIssue(21)]);
    const res = await GET(req, ctx("auto-nope"));
    expect(res.status).toBe(404);
  });

  it("resolves digit-leading kody task IDs via marker search, not as issue numbers", async () => {
    mocks.fetchIssues.mockResolvedValueOnce([makeIssue(22)]);
    mocks.fetchComments.mockResolvedValue([makeRawComment(6, "marker")]);
    mocks.parseAllComments.mockReturnValue([
      {
        type: "task-marker",
        taskId: "260701-auto-1",
        body: "",
        createdAt: "2026-07-01T11:00:00Z",
      },
    ]);

    const res = await GET(req, ctx("260701-auto-1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.task.id).toBe("260701-auto-1");
    // The whole-string ID check must keep this off the fetchIssue path.
    expect(mocks.fetchIssue).not.toHaveBeenCalled();
    mocks.parseAllComments.mockReturnValue([]);
    mocks.fetchComments.mockResolvedValue([]);
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await GET(req, ctx("issue-12"));
    expect(res.status).toBe(401);
    expect(mocks.fetchIssue).not.toHaveBeenCalled();
  });

  it("maps 401 GitHub errors to token-expired", async () => {
    mocks.fetchIssue.mockRejectedValueOnce(
      Object.assign(new Error("bad creds"), { status: 401 }),
    );
    const res = await GET(req, ctx("issue-12"));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("GitHub token expired");
  });

  it("maps 403 rate-limit errors to 429", async () => {
    mocks.fetchIssue.mockRejectedValueOnce(
      Object.assign(new Error("API rate limit exceeded"), { status: 403 }),
    );
    const res = await GET(req, ctx("issue-12"));
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(json.error).toBe("rate_limited");
  });

  it("maps other 403 errors to github_forbidden", async () => {
    mocks.fetchIssue.mockRejectedValueOnce(
      Object.assign(new Error("SAML enforcement"), { status: 403 }),
    );
    const res = await GET(req, ctx("issue-12"));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("github_forbidden");
  });

  it("returns 500 internal_error otherwise", async () => {
    mocks.fetchIssue.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req, ctx("issue-12"));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("internal_error");
    expect(json.message).toBe("boom");
  });
});
