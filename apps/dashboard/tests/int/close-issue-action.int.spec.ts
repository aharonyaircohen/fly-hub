/**
 * @fileoverview Integration tests for the issue-only backlog close action.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const issuesGet = vi.fn();
const issuesUpdate = vi.fn();
const updateIssue = vi.fn(async () => undefined);
const postComment = vi.fn(async () => undefined);
const invalidateTaskCache = vi.fn();
const invalidateBoardCache = vi.fn();

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => ({ ok: true })),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "tester" } })),
  getUserOctokit: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@kody-ade/base/branches", () => ({
  isProtectedBranch: vi.fn(() => false),
}));

vi.mock("@dashboard/lib/kody-command", () => ({
  withActor: vi.fn((body: string) => body),
  postWithFallback: vi.fn(async () => undefined),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  postComment: (...args: Parameters<typeof postComment>) =>
    postComment(...args),
  triggerWorkflow: vi.fn(async () => undefined),
  cancelWorkflowRun: vi.fn(async () => undefined),
  fetchComments: vi.fn(async () => []),
  fetchIssue: vi.fn(async () => null),
  fetchWorkflowRuns: vi.fn(async () => []),
  updateIssue: (...args: Parameters<typeof updateIssue>) =>
    updateIssue(...args),
  addAssignees: vi.fn(async () => undefined),
  removeAssignees: vi.fn(async () => undefined),
  addLabels: vi.fn(async () => undefined),
  removeLabel: vi.fn(async () => undefined),
  ensureLabel: vi.fn(async () => undefined),
  closePR: vi.fn(async () => undefined),
  findAssociatedPRByIssueNumber: vi.fn(async () => null),
  findTaskBranch: vi.fn(async () => null),
  deleteBranch: vi.fn(async () => undefined),
  invalidateTaskCache: (...args: Parameters<typeof invalidateTaskCache>) =>
    invalidateTaskCache(...args),
  invalidatePRCache: vi.fn(),
  invalidateBoardCache: (...args: Parameters<typeof invalidateBoardCache>) =>
    invalidateBoardCache(...args),
  invalidateBranchCache: vi.fn(),
  getOctokit: vi.fn(() => ({
    issues: { get: issuesGet, update: issuesUpdate },
  })),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

import { POST } from "../../app/api/kody/tasks/[taskId]/actions/route";

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const params = Promise.resolve({ taskId: "issue-42" });

describe("close-issue task action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issuesGet.mockResolvedValue({
      data: {
        number: 42,
        state: "open",
        pull_request: undefined,
      },
    });
    issuesUpdate.mockResolvedValue({
      data: {
        number: 42,
        state: "closed",
      },
    });
  });

  it("closes the GitHub issue without closing PRs or deleting branches", async () => {
    const res = await POST(
      makeReq({ action: "close-issue", actorLogin: "tester" }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(issuesGet).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
    });
    expect(issuesUpdate).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      state: "closed",
    });
    expect(updateIssue).not.toHaveBeenCalled();
    expect(postComment).toHaveBeenCalledWith(
      42,
      "🔒 Issue closed from backlog _(by @tester)_",
      undefined,
    );
    expect(invalidateTaskCache).toHaveBeenCalled();
    expect(invalidateBoardCache).toHaveBeenCalled();
  });

  it("refuses to close a pull request record", async () => {
    issuesGet.mockResolvedValue({
      data: {
        number: 42,
        state: "open",
        pull_request: {},
      },
    });

    const res = await POST(
      makeReq({ action: "close-issue", actorLogin: "tester" }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Backlog item is a pull request, not an issue");
    expect(updateIssue).not.toHaveBeenCalled();
    expect(issuesUpdate).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
  });

  it("treats an already-closed issue as success", async () => {
    issuesGet.mockResolvedValue({
      data: {
        number: 42,
        state: "closed",
        pull_request: undefined,
      },
    });

    const res = await POST(
      makeReq({ action: "close-issue", actorLogin: "tester" }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe("Issue already closed");
    expect(updateIssue).not.toHaveBeenCalled();
    expect(issuesUpdate).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
    expect(invalidateTaskCache).toHaveBeenCalled();
    expect(invalidateBoardCache).toHaveBeenCalled();
  });

  it("fails when GitHub does not confirm the issue closed", async () => {
    issuesUpdate.mockResolvedValue({
      data: {
        number: 42,
        state: "open",
      },
    });

    const res = await POST(
      makeReq({ action: "close-issue", actorLogin: "tester" }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBe("github_close_not_confirmed");
    expect(postComment).not.toHaveBeenCalled();
  });
});
