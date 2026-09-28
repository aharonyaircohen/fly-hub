import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({})),
}));
const githubClient = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
const runFiles = vi.hoisted(() => ({
  isWorkflowRunStateId: vi.fn((value: string) =>
    /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value),
  ),
  readLatestWorkflowRunStateFile: vi.fn(),
  readWorkflowRunStateFile: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => githubClient);
vi.mock("@dashboard/lib/workflow-run-state-files", () => runFiles);

import { GET } from "../../app/api/kody/company/workflows/[id]/runs/route";

describe("GET /api/kody/company/workflows/:id/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the latest persisted workflow cursor", async () => {
    runFiles.readLatestWorkflowRunStateFile.mockResolvedValue({
      workflowId: "pilot",
      runId: "run-abc",
      state: {
        status: "running",
        currentStepId: "verify",
        completedStepIds: ["inspect"],
        transitionCounts: {},
        facts: {},
        evidence: {},
        artifacts: [],
      },
    });
    const req = new NextRequest(
      "https://dash.test/api/kody/company/workflows/pilot/runs",
    );

    const res = await GET(req, { params: Promise.resolve({ id: "pilot" }) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      run: { runId: "run-abc", state: { currentStepId: "verify" } },
    });
    expect(runFiles.readLatestWorkflowRunStateFile).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "pilot",
    );
  });

  it("accepts the UUID run id returned by the workflow start route", async () => {
    const runId = "run-c770e912-6d17-4d92-a039-f8bd1292c256";
    runFiles.readWorkflowRunStateFile.mockResolvedValue({
      workflowId: "pilot",
      runId,
      state: { status: "done" },
    });
    const req = new NextRequest(
      `https://dash.test/api/kody/company/workflows/pilot/runs?runId=${runId}`,
    );

    const res = await GET(req, { params: Promise.resolve({ id: "pilot" }) });

    expect(res.status).toBe(200);
    expect(runFiles.readWorkflowRunStateFile).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "pilot",
      runId,
    );
  });
});
