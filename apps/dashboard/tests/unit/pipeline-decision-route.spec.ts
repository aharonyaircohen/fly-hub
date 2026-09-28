import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_test",
    owner: "acme",
    repo: "app",
  })),
  getUserOctokit: vi.fn(async () => ({})),
  verifyActorLogin: vi.fn(async () => ({ identity: { login: "alice" } })),
}));
const github = vi.hoisted(() => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
const pipeline = vi.hoisted(() => ({
  decidePipelineExecution: vi.fn(async () => ({ kind: "approved" })),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@dashboard/lib/github-client", () => github);
vi.mock(
  "@dashboard/features/pipelines/server/pipeline-orchestrator",
  () => pipeline,
);

import { POST } from "../../app/api/kody/company/pipelines/[id]/runs/[runId]/decision/route";

const params = {
  params: Promise.resolve({ id: "qa-maintenance", runId: "run-qa-1" }),
};

describe("POST pipeline decision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes the exact waiting pipeline as the signed-in actor", async () => {
    const response = await POST(
      new NextRequest(
        "https://dash.test/api/kody/company/pipelines/qa-maintenance/runs/run-qa-1/decision",
        {
          method: "POST",
          body: JSON.stringify({ decision: "approve" }),
        },
      ),
      params,
    );

    expect(response.status).toBe(200);
    expect(pipeline.decidePipelineExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        pipelineId: "qa-maintenance",
        runId: "run-qa-1",
        decision: "approve",
        decidedBy: "alice",
      }),
    );
  });

  it("rejects unsupported decisions", async () => {
    const response = await POST(
      new NextRequest(
        "https://dash.test/api/kody/company/pipelines/qa-maintenance/runs/run-qa-1/decision",
        {
          method: "POST",
          body: JSON.stringify({ decision: "dismiss" }),
        },
      ),
      params,
    );
    expect(response.status).toBe(400);
    expect(pipeline.decidePipelineExecution).not.toHaveBeenCalled();
  });
});
