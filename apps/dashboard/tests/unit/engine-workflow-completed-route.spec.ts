import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  resolveBackgroundToken: vi.fn(),
  dispatchWorkflowTriggers: vi.fn(),
  deliverWorkflowInboxAlert: vi.fn(),
  advancePipelineForWorkflowCompletion: vi.fn(),
  completeAgencyRequestsForWorkflow: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  qualityQuery: vi.fn(),
  qualityMutation: vi.fn(),
}));

vi.mock("@dashboard/lib/backend/github-actions-identity", () => ({
  bearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
  verifyGitHubWorkflowIdentity: h.verify,
}));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: h.resolveBackgroundToken,
}));
vi.mock("@kody-ade/base/github/core", () => ({
  createUserOctokit: vi.fn(() => ({ authenticated: true })),
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    quality: {
      getRun: "quality.getRun",
      getMap: "quality.getMap",
      updateRun: "quality.updateRun",
      appendRunEvent: "quality.appendRunEvent",
    },
    mcpApprovalRequests: {
      recordExecution: "mcpApprovalRequests.recordExecution",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: h.qualityQuery,
    mutation: h.qualityMutation,
  }),
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));
vi.mock(
  "@dashboard/features/workflows/server/github-workflow-trigger-dispatch",
  () => ({ dispatchWorkflowTriggers: h.dispatchWorkflowTriggers }),
);
vi.mock("@dashboard/features/workflows/server/workflow-inbox-alert", () => ({
  deliverWorkflowInboxAlert: h.deliverWorkflowInboxAlert,
}));
vi.mock("@dashboard/features/pipelines/server/pipeline-orchestrator", () => ({
  advancePipelineForWorkflowCompletion: h.advancePipelineForWorkflowCompletion,
}));
vi.mock("@dashboard/features/agency/server/agency-request-completion", () => ({
  completeAgencyRequestsForWorkflow: h.completeAgencyRequestsForWorkflow,
}));

import { POST } from "../../app/api/kody/engine/workflow-completed/route";

function request(body: unknown) {
  return new Request("http://localhost/api/kody/engine/workflow-completed", {
    method: "POST",
    headers: {
      authorization: "Bearer signed-github-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kody/engine/workflow-completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.verify.mockResolvedValue({
      repository: "acme/shop",
      actor: "kody",
      runId: "42",
    });
    h.resolveBackgroundToken.mockResolvedValue({ token: "background-token" });
    h.dispatchWorkflowTriggers.mockResolvedValue(undefined);
    h.deliverWorkflowInboxAlert.mockResolvedValue(undefined);
    h.advancePipelineForWorkflowCompletion.mockResolvedValue(undefined);
    h.completeAgencyRequestsForWorkflow.mockResolvedValue({ updated: 0 });
    h.qualityQuery.mockImplementation((name: string) => {
      if (name === "quality.getRun") {
        return Promise.resolve({
          run: { journeySlugs: ["direct-chat-persistence"] },
          events: [],
        });
      }
      if (name === "quality.getMap") {
        return Promise.resolve({
          journeys: [
            {
              slug: "direct-chat-persistence",
              name: "Direct chat persistence",
              actionSlugs: ["send-message"],
            },
          ],
          actions: [{ slug: "send-message", name: "Send message" }],
          scenarios: [],
        });
      }
      return Promise.resolve(null);
    });
    h.qualityMutation.mockResolvedValue(undefined);
  });

  it("notifies repository operators when a workflow is blocked", async () => {
    const response = await POST(
      request({
        workflowId: "review-fix",
        runId: "workflow-run-8",
        status: "blocked",
        summary: "UI Review could not run because LOGIN_PASSWORD is missing.",
        output: { pr: 3947 },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.deliverWorkflowInboxAlert).toHaveBeenCalledWith({
      owner: "acme",
      repo: "shop",
      workflowId: "review-fix",
      runId: "workflow-run-8",
      summary: "UI Review could not run because LOGIN_PASSWORD is missing.",
      url: "http://localhost/repo/acme/shop/workflows/review-fix",
      octokit: { authenticated: true },
    });
    expect(h.dispatchWorkflowTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          payload: expect.objectContaining({ status: "blocked" }),
        }),
      }),
    );
  });

  it("does not add an Inbox alert for a successful workflow", async () => {
    const response = await POST(
      request({
        workflowId: "review-fix",
        runId: "workflow-run-9",
        status: "success",
      }),
    );

    expect(response.status).toBe(204);
    expect(h.deliverWorkflowInboxAlert).not.toHaveBeenCalled();
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "mcpApprovalRequests.recordExecution",
      expect.objectContaining({
        tenantId: "acme/shop",
        workflowId: "review-fix",
        runId: "workflow-run-9",
        status: "success",
        githubRunId: "42",
        githubRunUrl: "https://github.com/acme/shop/actions/runs/42",
      }),
    );
  });

  it("records Quality Run completion and evidence in Convex", async () => {
    const response = await POST(
      request({
        workflowId: "quality-run",
        runId: "run-quality-1",
        status: "success",
        summary: "Direct chat persistence passed.",
        output: {
          journeyName: "Direct chat persistence",
          artifactPath:
            "apps/dashboard/test-results/live-ui-gate/run-quality-1",
          usage: {
            version: 1,
            tokens: {
              input: 709_564,
              output: 2_091,
              cacheRead: 1_536,
              cacheCreate: 0,
              total: 713_191,
            },
            costUsd: 2.1769996,
            agentRuns: 1,
            turns: 20,
            measurement: "reported",
            byModel: {
              "minimax/MiniMax-M3": {
                tokens: {
                  input: 709_564,
                  output: 2_091,
                  cacheRead: 1_536,
                  cacheCreate: 0,
                  total: 713_191,
                },
                costUsd: 2.1605178,
                agentRuns: 1,
                turns: 20,
                measurement: "reported",
              },
            },
          },
          actionResults: [
            {
              actionSlug: "send-message",
              actionName: "Send message",
              status: "passed",
              evidence: "A fresh reply remained visible after reload.",
              issueSource: "none",
              cause: "The Action completed as expected.",
              correction: "No correction is needed.",
              artifactPath:
                "test-results/quality-runs/run-quality-1/01-send-message.png",
            },
          ],
          journeyResults: [
            {
              journeySlug: "direct-chat-persistence",
              journeyName: "Direct chat persistence",
              status: "passed",
              evidence: "The direct chat Journey completed.",
              issueSource: "none",
              cause: "Every Action completed.",
              correction: "No correction is needed.",
              artifactPath:
                "test-results/quality-runs/run-quality-1/journey-1.png",
            },
          ],
          scenarioResult: {
            status: "passed",
            evidence: "The saved reply remained visible after reload.",
            issueSource: "none",
            cause: "The Scenario expectations were satisfied.",
            correction: "No correction is needed.",
            artifactPath: "test-results/quality-runs/run-quality-1/final.png",
          },
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.updateRun",
      expect.objectContaining({
        tenantId: "acme/shop",
        runId: "run-quality-1",
        status: "passed",
      }),
    );
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.appendRunEvent",
      expect.objectContaining({
        runId: "run-quality-1",
        event: expect.objectContaining({
          type: "quality_run_completed",
          journeyName: "Direct chat persistence",
          artifactPath:
            "apps/dashboard/test-results/live-ui-gate/run-quality-1",
          artifactUrl: "https://github.com/acme/shop/actions/runs/42",
          passed: 1,
          failed: 0,
          blocked: 0,
          usage: expect.objectContaining({
            measurement: "reported",
            tokens: expect.objectContaining({ total: 713_191 }),
            costUsd: 2.1769996,
            turns: 20,
          }),
          journeyResults: [
            expect.objectContaining({
              journeySlug: "direct-chat-persistence",
              journeyName: "Direct chat persistence",
              status: "passed",
            }),
          ],
          actionResults: [
            expect.objectContaining({
              actionSlug: "send-message",
              status: "passed",
              issueSource: "none",
              cause: "The Action completed as expected.",
              correction: "No correction is needed.",
            }),
          ],
          scenarioResult: expect.objectContaining({
            issueSource: "none",
            cause: "The Scenario expectations were satisfied.",
            correction: "No correction is needed.",
          }),
        }),
      }),
    );
  });

  it("uses the saved Action identity when the runner repeats its label differently", async () => {
    const response = await POST(
      request({
        workflowId: "quality-run",
        runId: "run-quality-canonical-action",
        status: "success",
        summary: "Direct chat persistence passed.",
        output: {
          actionResults: [
            {
              actionSlug: "send-message-with-a-label-typo",
              actionName: "Send a message",
              status: "passed",
              evidence: "A fresh reply remained visible after reload.",
              artifactPath:
                "test-results/quality-runs/run-quality-canonical-action/01-action.png",
            },
          ],
          scenarioResult: {
            status: "passed",
            evidence: "The saved reply remained visible after reload.",
            artifactPath:
              "test-results/quality-runs/run-quality-canonical-action/final.png",
          },
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.appendRunEvent",
      expect.objectContaining({
        event: expect.objectContaining({
          status: "passed",
          actionResults: [
            expect.objectContaining({
              actionSlug: "send-message",
              actionName: "Send message",
              status: "passed",
            }),
          ],
        }),
      }),
    );
  });

  it("blocks a Quality result that does not report the saved Actions", async () => {
    const response = await POST(
      request({
        workflowId: "quality-run",
        runId: "run-quality-invalid",
        status: "success",
        summary: "Everything passed.",
        output: {
          actionResults: [
            {
              actionSlug: "different-action",
              actionName: "Different action",
              status: "passed",
              evidence: "Old conversation was visible.",
              artifactPath:
                "test-results/quality-runs/older-run/01-different.png",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.updateRun",
      expect.objectContaining({
        runId: "run-quality-invalid",
        status: "blocked",
      }),
    );
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.appendRunEvent",
      expect.objectContaining({
        event: expect.objectContaining({
          type: "quality_run_completed",
          status: "blocked",
          summary:
            "Quality result is missing the required Journey, Action, or Scenario results.",
        }),
      }),
    );
  });

  it("preserves the workflow failure when the runner cannot return a result", async () => {
    const response = await POST(
      request({
        workflowId: "quality-run",
        runId: "run-quality-runtime-failure",
        status: "failed",
        summary: "The browser runner reached its turn limit.",
        output: {},
      }),
    );

    expect(response.status).toBe(204);
    expect(h.qualityMutation).toHaveBeenCalledWith(
      "quality.appendRunEvent",
      expect.objectContaining({
        event: expect.objectContaining({
          type: "quality_run_completed",
          status: "blocked",
          summary: "The browser runner reached its turn limit.",
        }),
      }),
    );
  });

  it("keeps the completed workflow intact when Inbox delivery fails", async () => {
    h.deliverWorkflowInboxAlert.mockRejectedValueOnce(
      new Error("Inbox unavailable"),
    );

    const response = await POST(
      request({
        workflowId: "review-fix",
        runId: "workflow-run-10",
        status: "blocked",
        summary: "QA credentials are missing.",
      }),
    );

    expect(response.status).toBe(204);
    expect(h.dispatchWorkflowTriggers).toHaveBeenCalledTimes(1);
  });

  it("accepts completion and shortens an oversized optional summary", async () => {
    const response = await POST(
      request({
        workflowId: "review-fix",
        runId: "workflow-run-long-summary",
        status: "blocked",
        summary: "x".repeat(1_200),
        output: { pr: 3947, verdict: "pass" },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.advancePipelineForWorkflowCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: "workflow-run-long-summary",
        output: { pr: 3947, verdict: "pass" },
      }),
    );
    expect(h.dispatchWorkflowTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          payload: expect.objectContaining({
            summary: "x".repeat(1_000),
          }),
        }),
      }),
    );
    expect(h.deliverWorkflowInboxAlert).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "x".repeat(1_000) }),
    );
  });

  it("dispatches a repository-scoped Kody workflow completion event", async () => {
    const response = await POST(
      request({
        workflowId: "ci-repair",
        runId: "workflow-run-7",
        loopId: "agency-request-build-healthy-ci",
        status: "success",
        output: {
          pr: 3947,
          headSha: "abcdef1234567",
          verdict: "pass",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(h.completeAgencyRequestsForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "ci-repair",
        runId: "workflow-run-7",
        loopId: "agency-request-build-healthy-ci",
        status: "success",
      }),
    );
    expect(h.setGitHubContext).toHaveBeenCalledWith(
      "acme",
      "shop",
      "background-token",
    );
    expect(h.dispatchWorkflowTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "kody-workflow:ci-repair:workflow-run-7",
        event: expect.objectContaining({
          name: "kody.workflow.completed",
          brand: { owner: "acme", repo: "shop" },
          payload: expect.objectContaining({
            workflowId: "ci-repair",
            runId: "workflow-run-7",
            loopId: "agency-request-build-healthy-ci",
            status: "success",
            pr: 3947,
            verdict: "pass",
          }),
        }),
      }),
    );
    expect(h.advancePipelineForWorkflowCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        output: {
          pr: 3947,
          headSha: "abcdef1234567",
          verdict: "pass",
        },
      }),
    );
    expect(h.clearGitHubContext).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged repository field", async () => {
    const response = await POST(
      request({
        workflowId: "ci-repair",
        runId: "workflow-run-7",
        status: "success",
        repository: "attacker/repo",
      }),
    );

    expect(response.status).toBe(400);
    expect(h.dispatchWorkflowTriggers).not.toHaveBeenCalled();
  });
});
