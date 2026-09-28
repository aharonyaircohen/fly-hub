/**
 * @fileoverview Integration tests for POST /api/kody/tasks/[taskId]/start.
 * @testFramework vitest
 * @domain kody
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null as unknown),
  getRequestAuth: vi.fn(
    () =>
      ({
        owner: "owner",
        repo: "repo",
        token: "tok",
      }) as unknown,
  ),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "tester" },
  }) as unknown),
  startKodyTask: vi.fn(async () => ({
    success: true,
    message: "started",
    issueNumber: 674,
    workflowDispatched: true,
    backlogLabelApplied: true,
    tokenSource: "env",
    workflowId: "kody.yml",
    ref: "main",
  })),
  recordAudit: vi.fn(),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: (...a: unknown[]) => mocks.requireKodyAuth(...(a as [])),
  getRequestAuth: (...a: unknown[]) => mocks.getRequestAuth(...(a as [])),
  verifyActorLogin: (...a: unknown[]) => mocks.verifyActorLogin(...(a as [])),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: (...a: unknown[]) => mocks.recordAudit(...(a as [])),
}));

vi.mock("@dashboard/lib/tasks/start-task", () => ({
  startKodyTask: (...a: unknown[]) => mocks.startKodyTask(...(a as [])),
}));

import { NextResponse } from "next/server";
import { POST } from "../../app/api/kody/tasks/[taskId]/start/route";

const req = (body?: unknown) =>
  ({
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  }) as unknown as Parameters<typeof POST>[0];

const ctx = (taskId = "issue-674") => ({
  params: Promise.resolve({ taskId }),
});

describe("POST /api/kody/tasks/[taskId]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the task via the server command path", async () => {
    const res = await POST(req({ actorLogin: "tester" }), ctx());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      issueNumber: 674,
      workflowDispatched: true,
    });
    expect(mocks.startKodyTask).toHaveBeenCalledWith("issue-674", "tester");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "task.start", resource: "issue-674" }),
    );
  });

  it("tolerates a missing JSON body", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(mocks.verifyActorLogin).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
  });

  it("returns 400 when repo auth headers are missing", async () => {
    mocks.getRequestAuth.mockReturnValueOnce(null);
    const res = await POST(req({}), ctx());
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("no_repo_context");
    expect(mocks.startKodyTask).not.toHaveBeenCalled();
  });

  it("returns the auth response when unauthenticated", async () => {
    mocks.requireKodyAuth.mockResolvedValueOnce(
      NextResponse.json({ message: "nope" }, { status: 401 }),
    );
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(401);
    expect(mocks.startKodyTask).not.toHaveBeenCalled();
  });

  it("propagates actor verification failures", async () => {
    mocks.verifyActorLogin.mockResolvedValueOnce(
      NextResponse.json({ error: "actor_mismatch" }, { status: 403 }),
    );
    const res = await POST(req({ actorLogin: "impostor" }), ctx());
    expect(res.status).toBe(403);
    expect(mocks.startKodyTask).not.toHaveBeenCalled();
  });

  it("maps 'Invalid task ID' to 400", async () => {
    mocks.startKodyTask.mockRejectedValueOnce(new Error("Invalid task ID"));
    const res = await POST(req({}), ctx("issue-nan"));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("task_start_failed");
    expect(json.message).toBe("Invalid task ID");
  });

  it("maps other failures to 500", async () => {
    mocks.startKodyTask.mockRejectedValueOnce(new Error("dispatch exploded"));
    const res = await POST(req({}), ctx());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json).toEqual({
      error: "task_start_failed",
      message: "dispatch exploded",
    });
  });
});
