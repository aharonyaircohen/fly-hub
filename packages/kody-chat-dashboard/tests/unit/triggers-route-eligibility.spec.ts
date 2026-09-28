import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  mutateTriggers: vi.fn(),
  query: vi.fn(),
  readTrust: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: vi.fn(() => ({
    auth: { owner: "acme", repo: "widgets", token: "token" },
    octokit: {},
    actorLogin: "alice",
    actorGithubId: 1,
    permission: "admin",
  })),
  verifyRepoReadAccess: vi.fn(),
}));
vi.mock("@kody-ade/base/events", () => ({
  isSystemEventName: vi.fn(() => true),
}));
vi.mock("@kody-ade/base/triggers", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@kody-ade/base/triggers")>();
  return {
    ...original,
    getTriggers: vi.fn(),
    mutateTriggers: dependencies.mutateTriggers,
  };
});
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: dependencies.query }),
}));
vi.mock("@kody-ade/agency/cto/trust-store", () => ({
  readTrust: dependencies.readTrust,
}));
vi.mock("@kody-ade/base/github/core", () => ({
  setGitHubContext: dependencies.setGitHubContext,
  clearGitHubContext: dependencies.clearGitHubContext,
}));
vi.mock("../../src/dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

import { POST } from "../../app/api/kody/triggers/route";

function request(workflowId = "guarded") {
  return new NextRequest("https://dashboard.example.com/api/kody/triggers", {
    method: "POST",
    body: JSON.stringify({
      trigger: {
        id: "after-ci",
        name: "After CI",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: { type: "start-workflow", workflowId, inputMap: {} },
      },
    }),
  });
}

function pipelineRequest(pipelineId = "guarded-pipeline") {
  return new NextRequest("https://dashboard.example.com/api/kody/triggers", {
    method: "POST",
    body: JSON.stringify({
      trigger: {
        id: "after-review",
        name: "After review",
        enabled: true,
        event: "kody.workflow.completed",
        conditions: [],
        action: { type: "start-pipeline", pipelineId, inputMap: {} },
      },
    }),
  });
}

describe("POST /api/kody/triggers workflow policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.query.mockResolvedValue({
      workflowId: "guarded",
      definition: {
        name: "Guarded",
        agent: "kody",
        capabilities: ["ci-health-check"],
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
      },
      source: "local",
      updatedAt: "2026-08-07T00:00:00.000Z",
    });
    dependencies.readTrust.mockResolvedValue({ subjects: {} });
    dependencies.mutateTriggers.mockResolvedValue(undefined);
  });

  it("rejects a workflow that requires approval", async () => {
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "workflow_not_automation_eligible",
      reason: "approval-required",
    });
    expect(dependencies.mutateTriggers).not.toHaveBeenCalled();
  });

  it("rejects a missing workflow", async () => {
    dependencies.query.mockResolvedValue(null);

    const response = await POST(request("missing"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "workflow_not_found",
    });
    expect(dependencies.mutateTriggers).not.toHaveBeenCalled();
  });

  it("rejects a Pipeline that requires approval", async () => {
    dependencies.query.mockResolvedValue({
      pipelineId: "guarded-pipeline",
      definition: {
        name: "Guarded Pipeline",
        steps: [{ id: "review", workflow: "review-fix" }],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
      source: "local",
      updatedAt: "2026-08-08T00:00:00.000Z",
    });

    const response = await POST(pipelineRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "pipeline_not_automation_eligible",
      reason: "approval-required",
    });
    expect(dependencies.mutateTriggers).not.toHaveBeenCalled();
  });
});
