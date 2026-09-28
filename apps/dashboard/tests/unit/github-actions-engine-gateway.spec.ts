import { describe, expect, it, vi } from "vitest";

import { createGitHubActionsEngineGateway } from "@dashboard/features/workflows/server/github-actions-engine-gateway";

describe("GitHubActionsEngineGateway", () => {
  it("passes the complete Engine request through kody.yml", async () => {
    const createWorkflowDispatch = vi.fn(async () => ({ status: 204 }));
    const octokit = {
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: "main" } })),
          getContent: vi.fn(async () => ({
            data: {
              encoding: "base64",
              content: Buffer.from(
                "on:\n  workflow_dispatch:\n    inputs:\n      requestId:\n        type: string\n      runRequest:\n        type: string\n      model:\n        type: string\n      dashboardUrl:\n        type: string\n      storeRepoUrl:\n        type: string\n      storeRef:\n        type: string\n",
              ).toString("base64"),
            },
          })),
        },
        actions: { createWorkflowDispatch },
      },
    };
    const gateway = createGitHubActionsEngineGateway({
      octokit,
      owner: "acme",
      repo: "widgets",
      dashboardUrl: "https://dashboard.example.test",
      storeRepoUrl: "https://github.com/acme/company-store.git",
      storeRef: "stable",
      model: "minimax/MiniMax-M3",
      now: () => new Date("2026-07-27T12:00:00.000Z"),
    });
    const request = {
      requestId: "run-memory-1",
      target: { type: "workflow" as const, id: "learn-from-runs" },
      intent: "run" as const,
      source: "dashboard" as const,
    };

    await expect(gateway(request)).resolves.toEqual({
      requestId: "run-memory-1",
      acceptedAt: "2026-07-27T12:00:00.000Z",
    });
    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      workflow_id: "kody.yml",
      ref: "main",
      inputs: {
        requestId: "run-memory-1",
        runRequest: JSON.stringify(request),
        model: "minimax/MiniMax-M3",
        dashboardUrl: "https://dashboard.example.test",
        storeRepoUrl: "acme/company-store",
        storeRef: "stable",
      },
    });

    await gateway({ ...request, requestId: "run-memory-2" });
    expect(octokit.rest.repos.get).toHaveBeenCalledTimes(1);
    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
    expect(createWorkflowDispatch).toHaveBeenCalledTimes(2);
  });
});
