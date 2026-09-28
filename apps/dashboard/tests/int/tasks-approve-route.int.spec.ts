/**
 * @fileoverview Integration tests for POST /api/kody/tasks/approve.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "tester" },
  }) as unknown),
  getUserOctokit: vi.fn(async () => null),
  attemptSquashMerge: vi.fn(async () => ({ kind: "merged" }) as unknown),
  createReview: vi.fn(async () => undefined),
  deleteRef: vi.fn(async () => undefined),
  issuesUpdate: vi.fn(async () => undefined),
  isProtectedBranch: vi.fn(() => false),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  verifyActorLogin: (...a: unknown[]) => mocks.verifyActorLogin(...(a as [])),
  getUserOctokit: (...a: unknown[]) => mocks.getUserOctokit(...(a as [])),
  getRequestAuth: vi.fn(() => null),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(() => ({
    pulls: {
      createReview: (...a: unknown[]) => mocks.createReview(...(a as [])),
    },
    git: { deleteRef: (...a: unknown[]) => mocks.deleteRef(...(a as [])) },
    issues: { update: (...a: unknown[]) => mocks.issuesUpdate(...(a as [])) },
  })),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  getOwner: vi.fn(() => "owner"),
  getRepo: vi.fn(() => "repo"),
}));

vi.mock("@kody-ade/base/branches", () => ({
  isProtectedBranch: (...a: unknown[]) => mocks.isProtectedBranch(...(a as [])),
}));

vi.mock("@dashboard/lib/kody/squash-merge", () => ({
  attemptSquashMerge: (...a: unknown[]) =>
    mocks.attemptSquashMerge(...(a as [])),
}));

import { NextResponse } from "next/server";
import { POST } from "../../app/api/kody/tasks/approve/route";

const req = (body: unknown) =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];

const validBody = {
  issueNumber: 674,
  prNumber: 99,
  branchName: "674-fix",
  actorLogin: "tester",
};

describe("POST /api/kody/tasks/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attemptSquashMerge.mockResolvedValue({ kind: "merged" });
    mocks.isProtectedBranch.mockReturnValue(false);
  });

  it("approves, merges, deletes the branch, and closes the issue", async () => {
    const res = await POST(req(validBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.results).toEqual([
      "Merged PR #99",
      "Deleted branch 674-fix",
      "Closed issue #674",
    ]);
    expect(mocks.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 99, event: "APPROVE" }),
    );
    expect(mocks.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "heads/674-fix" }),
    );
    expect(mocks.issuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 674, state: "closed" }),
    );
  });

  it("rejects invalid payloads with 400", async () => {
    const res = await POST(req({ issueNumber: -1 }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid request");
    expect(mocks.attemptSquashMerge).not.toHaveBeenCalled();
  });

  it("returns 409 and leaves branch/issue intact when CI blocks the merge", async () => {
    mocks.attemptSquashMerge.mockResolvedValueOnce({ kind: "failed-ci" });
    const res = await POST(req(validBody));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toBe("merge_blocked_ci");
    expect(mocks.deleteRef).not.toHaveBeenCalled();
    expect(mocks.issuesUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 for merge conflicts", async () => {
    mocks.attemptSquashMerge.mockResolvedValueOnce({ kind: "failed-conflict" });
    const res = await POST(req(validBody));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toBe("merge_blocked_conflict");
    expect(mocks.deleteRef).not.toHaveBeenCalled();
  });

  it("returns 502 for other merge failures (401 passes through)", async () => {
    mocks.attemptSquashMerge.mockResolvedValueOnce({
      kind: "failed-other",
      message: "base branch was modified",
      status: 405,
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("merge_failed");

    mocks.attemptSquashMerge.mockResolvedValueOnce({
      kind: "failed-other",
      message: "bad credentials",
      status: 401,
    });
    const res2 = await POST(req(validBody));
    expect(res2.status).toBe(401);
  });

  it("skips branch deletion for protected branches", async () => {
    mocks.isProtectedBranch.mockReturnValueOnce(true);
    const res = await POST(req({ ...validBody, branchName: "main" }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mocks.deleteRef).not.toHaveBeenCalled();
    expect(mocks.issuesUpdate).toHaveBeenCalled();
  });

  it("treats an already-deleted branch (422) as success", async () => {
    mocks.deleteRef.mockRejectedValueOnce(
      Object.assign(new Error("Reference does not exist"), { status: 422 }),
    );
    const res = await POST(req(validBody));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.results).toContain("Branch 674-fix was already deleted");
  });

  it("still succeeds when the review approval fails", async () => {
    mocks.createReview.mockRejectedValueOnce(new Error("already approved"));
    const res = await POST(req(validBody));
    expect((await res.json()).success).toBe(true);
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
    expect(mocks.attemptSquashMerge).not.toHaveBeenCalled();
  });

  it("maps thrown 401 errors to github_token_expired", async () => {
    mocks.attemptSquashMerge.mockRejectedValueOnce(
      Object.assign(new Error("Bad credentials"), { status: 401 }),
    );
    const res = await POST(req(validBody));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error).toBe("github_token_expired");
  });
});
