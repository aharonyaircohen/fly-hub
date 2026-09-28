import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveBackgroundToken = vi.fn();
const getRepo = vi.fn();
const createWorkflowDispatch = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      rest: {
        repos: { get: getRepo },
        actions: { createWorkflowDispatch },
      },
    };
  }),
}));

vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: (...args: unknown[]) =>
    resolveBackgroundToken(...args),
}));

import { POST } from "../../app/api/kody/loop-wakes/dispatch/route";

function request(
  token = "wake-secret",
  body: unknown = {
    jobId: "wake-1",
    repo: "acme/widgets",
    runRequest: {
      requestId: "wake-1",
      target: { type: "loop", id: "daily-check" },
      intent: "tick",
      source: "schedule",
      input: { scheduledFor: "2026-08-19T12:00:00.000Z" },
    },
  },
) {
  return new NextRequest(
    "https://dashboard.test/api/kody/loop-wakes/dispatch",
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/kody/loop-wakes/dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("KODY_LOOP_WAKE_API_KEY", "wake-secret");
    resolveBackgroundToken.mockResolvedValue({
      token: "github-token",
      source: "app",
    });
    getRepo.mockResolvedValue({ data: { default_branch: "trunk" } });
    createWorkflowDispatch.mockResolvedValue({ status: 204 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects a wrong service key", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("dispatches the canonical scheduled fan-out through GitHub Actions", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runner: "github-actions",
    });

    expect(resolveBackgroundToken).toHaveBeenCalledWith("acme", "widgets");
    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      workflow_id: "kody.yml",
      ref: "trunk",
      inputs: {
        requestId: "wake-1",
        runRequest: JSON.stringify({
          requestId: "wake-1",
          target: { type: "loop", id: "daily-check" },
          intent: "tick",
          source: "schedule",
          input: { scheduledFor: "2026-08-19T12:00:00.000Z" },
        }),
      },
    });
  });

  it("rejects any request other than scheduled fan-out", async () => {
    const response = await POST(
      request("wake-secret", {
        jobId: "wake-1",
        repo: "acme/widgets",
        runRequest: {
          requestId: "wake-1",
          target: { type: "workflow", id: "dangerous" },
          intent: "tick",
          source: "schedule",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("does not start when repository access is unavailable", async () => {
    resolveBackgroundToken.mockResolvedValueOnce(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("reports a GitHub dispatch failure without leaking details", async () => {
    createWorkflowDispatch.mockRejectedValueOnce(new Error("secret detail"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub workflow dispatch failed",
    });
  });
});
