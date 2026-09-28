import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getTriggers: vi.fn(),
  triggerMatches: vi.fn(),
  resolveActionData: vi.fn(),
  mutation: vi.fn(),
  startWorkflow: vi.fn(),
  startPipelineExecution: vi.fn(),
  listJobsForWorkflowRun: vi.fn(),
}));

vi.mock("@kody-ade/base/triggers/config", () => ({
  getTriggers: h.getTriggers,
}));
vi.mock("@kody-ade/base/triggers/engine", () => ({
  triggerMatches: h.triggerMatches,
  resolveActionData: h.resolveActionData,
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ mutation: h.mutation }),
}));
vi.mock("@dashboard/features/workflows/server/company-workflow-loader", () => ({
  createCompanyWorkflowLoader: vi.fn(() => vi.fn()),
}));
vi.mock("@dashboard/features/pipelines/server/company-pipeline-loader", () => ({
  createCompanyPipelineLoader: vi.fn(() =>
    vi.fn(async () => ({
      pipeline: {
        name: "Review and Merge",
        steps: [{ id: "review", workflow: "review-fix" }],
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    })),
  ),
}));
vi.mock(
  "@dashboard/features/pipelines/server/pipeline-execution-authorization",
  () => ({ pipelineRequiresApproval: vi.fn(async () => false) }),
);
vi.mock("@dashboard/features/pipelines/server/pipeline-orchestrator", () => ({
  startPipelineExecution: h.startPipelineExecution,
}));
vi.mock(
  "@dashboard/features/workflows/server/github-actions-engine-gateway",
  () => ({ createGitHubActionsEngineGateway: vi.fn(() => vi.fn()) }),
);
vi.mock(
  "@dashboard/features/workflows/server/workflow-execution-authorization",
  () => ({
    workflowRequiresApproval: vi.fn(async () => false),
  }),
);
vi.mock("../../src/dashboard/features/workflows/server/start-workflow", () => ({
  startWorkflow: h.startWorkflow,
}));
vi.mock("@kody-ade/agency/agency-approvals", () => ({
  consumeStoredAgencyApproval: vi.fn(),
}));
vi.mock("@kody-ade/agency/workflow-run-approval", () => ({
  workflowRunAction: vi.fn(() => "run"),
}));
vi.mock("@dashboard/lib/workflow-definitions", () => ({
  validateWorkflowDefinition: vi.fn(() => []),
  validateWorkflowInput: vi.fn(() => []),
}));
vi.mock("@dashboard/lib/pipeline-definitions", () => ({
  validatePipelineDefinition: vi.fn(() => []),
}));
vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

import { dispatchGitHubWorkflowTriggers } from "../../src/dashboard/features/workflows/server/github-workflow-trigger-dispatch";

const octokit = {
  rest: {
    actions: {
      listJobsForWorkflowRun: h.listJobsForWorkflowRun,
    },
  },
} as never;

const event = {
  id: "delivery-1",
  name: "github.workflow_run.completed",
  version: 1,
  occurredAt: "2026-08-04T07:00:00.000Z",
  userId: "github:99",
  sessionId: null,
  brand: { owner: "acme", repo: "shop" },
  source: "server" as const,
  payload: { runId: 42, conclusion: "failure", repository: "acme/shop" },
};

describe("dispatchGitHubWorkflowTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getTriggers.mockResolvedValue([
      {
        id: "ci-repair-on-failure",
        name: "Repair failed CI",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: {
          type: "start-workflow",
          workflowId: "ci-repair",
          inputMap: { sourceRunId: "payload.runId" },
        },
      },
    ]);
    h.triggerMatches.mockReturnValue(true);
    h.resolveActionData.mockReturnValue({ sourceRunId: 42 });
    h.mutation.mockResolvedValue({ claimed: true, status: "pending" });
    h.startWorkflow.mockResolvedValue({
      kind: "accepted",
      workflowId: "ci-repair",
      requestId: "github-request",
      acceptedAt: "2026-08-04T07:00:00.000Z",
    });
    h.startPipelineExecution.mockResolvedValue({
      claimed: true,
      acceptedAt: "2026-08-04T07:00:00.000Z",
    });
    h.listJobsForWorkflowRun.mockResolvedValue({
      data: {
        jobs: [
          {
            conclusion: "failure",
            runner_name: "GitHub Actions 123",
            steps: [{ name: "Set up job", conclusion: "success" }],
          },
        ],
      },
    });
  });

  it("claims the delivery and starts the configured Workflow", async () => {
    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.mutation).toHaveBeenCalledTimes(2);
    expect(h.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "ci-repair",
        source: "github",
        requestId: expect.stringMatching(/^github-/),
        input: { sourceRunId: 42 },
      }),
      expect.any(Object),
    );
  });

  it("treats each GitHub run attempt as a separate source event", async () => {
    await dispatchGitHubWorkflowTriggers({
      event: {
        ...event,
        payload: { ...event.payload, runAttempt: 2 },
      },
      deliveryId: "delivery-attempt-2",
      octokit,
    });

    expect(h.mutation.mock.calls[0]?.[1]).toMatchObject({
      sourceEventId: "github.workflow_run.completed:42:attempt:2",
    });
  });

  it("starts an allowed Pipeline with a stable run id", async () => {
    h.getTriggers.mockResolvedValue([
      {
        id: "review-after-ci",
        name: "Review after CI",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: {
          type: "start-pipeline",
          pipelineId: "review-and-merge",
          inputMap: { pr: "payload.pr" },
          concurrencyKey: "branch",
        },
      },
    ]);
    h.resolveActionData.mockReturnValue({ pr: 3943, branch: "main" });

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.startPipelineExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "review-and-merge",
        pipelineRunId: expect.stringMatching(/^run-trigger-/),
        facts: { pr: 3943, branch: "main" },
        concurrencyKey: "main",
      }),
    );
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("does not start a Pipeline when its concurrency input is missing", async () => {
    h.getTriggers.mockResolvedValue([
      {
        id: "repair-after-ci",
        name: "Repair after CI",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: {
          type: "start-pipeline",
          pipelineId: "ci-repair",
          inputMap: { branch: "payload.branch" },
          concurrencyKey: "branch",
        },
      },
    ]);
    h.resolveActionData.mockReturnValue({});

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.startPipelineExecution).not.toHaveBeenCalled();
  });

  it("uses a stable source id for a completed Kody workflow run", async () => {
    await dispatchGitHubWorkflowTriggers({
      event: {
        ...event,
        id: "event-7",
        name: "kody.workflow.completed",
        payload: {
          workflowId: "ci-repair",
          runId: "run-7",
          status: "success",
          repository: "acme/shop",
          pr: 3947,
        },
      },
      deliveryId: "kody-workflow-run-7",
      octokit,
    });

    expect(h.mutation.mock.calls[0]?.[1]).toMatchObject({
      sourceEventId: "kody.workflow.completed:run-7",
    });
    expect(h.listJobsForWorkflowRun).not.toHaveBeenCalled();
  });

  it("does not start the Workflow when the durable claim is already taken", async () => {
    h.mutation.mockResolvedValue({ claimed: false, status: "dispatched" });

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.startWorkflow).not.toHaveBeenCalled();
    expect(h.mutation).toHaveBeenCalledTimes(1);
  });

  it("does not inspect jobs when no configured trigger matches", async () => {
    h.triggerMatches.mockReturnValue(false);

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.listJobsForWorkflowRun).not.toHaveBeenCalled();
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("does not let the Kody Engine workflow recursively trigger itself", async () => {
    await dispatchGitHubWorkflowTriggers({
      event: {
        ...event,
        payload: {
          ...event.payload,
          workflowPath: ".github/workflows/kody.yml",
        },
      },
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("continues with another trigger when one trigger throws", async () => {
    h.getTriggers.mockResolvedValue([
      {
        id: "first-trigger",
        name: "First",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: { type: "start-workflow", workflowId: "first", inputMap: {} },
      },
      {
        id: "second-trigger",
        name: "Second",
        enabled: true,
        event: "github.workflow_run.completed",
        conditions: [],
        action: { type: "start-workflow", workflowId: "second", inputMap: {} },
      },
    ]);
    h.startWorkflow
      .mockRejectedValueOnce(new Error("first dispatch failed"))
      .mockResolvedValueOnce({
        kind: "accepted",
        workflowId: "second",
        requestId: "github-request-2",
        acceptedAt: "2026-08-04T07:00:00.000Z",
      });

    await expect(
      dispatchGitHubWorkflowTriggers({
        event,
        deliveryId: "delivery-1",
        octokit,
      }),
    ).resolves.toBeUndefined();
    expect(h.startWorkflow).toHaveBeenCalledTimes(2);
  });

  it("records oversized input after claiming the delivery", async () => {
    h.resolveActionData.mockReturnValue({ payload: "x".repeat(64_001) });

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.startWorkflow).not.toHaveBeenCalled();
    expect(h.mutation).toHaveBeenCalledTimes(2);
    expect(h.mutation.mock.calls[1]?.[1]).toMatchObject({
      error: "workflow input exceeds 64KB",
    });
  });

  it("does not start CI Repair when GitHub never assigned a runner", async () => {
    h.listJobsForWorkflowRun.mockResolvedValue({
      data: {
        jobs: [
          {
            conclusion: "cancelled",
            runner_name: "",
            steps: [],
          },
        ],
      },
    });

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("does not start CI Repair for a cancelled run that never acquired a runner", async () => {
    h.listJobsForWorkflowRun.mockResolvedValue({
      data: {
        jobs: [
          {
            conclusion: "cancelled",
            runner_name: "",
            steps: [],
          },
        ],
      },
    });

    await dispatchGitHubWorkflowTriggers({
      event: {
        ...event,
        payload: { ...event.payload, conclusion: "cancelled" },
      },
      deliveryId: "delivery-cancelled-before-start",
      octokit,
    });

    expect(h.mutation).not.toHaveBeenCalled();
    expect(h.startWorkflow).not.toHaveBeenCalled();
  });

  it("keeps normal CI repair behavior when source-run inspection fails", async () => {
    h.listJobsForWorkflowRun.mockRejectedValue(new Error("GitHub unavailable"));

    await dispatchGitHubWorkflowTriggers({
      event,
      deliveryId: "delivery-1",
      octokit,
    });

    expect(h.startWorkflow).toHaveBeenCalledTimes(1);
  });
});
