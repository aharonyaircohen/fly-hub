import { describe, expect, it, vi } from "vitest";

import {
  startWorkflow,
  type WorkflowExecutionDependencies,
} from "@dashboard/features/workflows/server/start-workflow";

const workflow = {
  name: "Learn from Runs",
  agent: "memory-steward",
  capabilities: ["extract-run-learning"],
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
};

function dependencies(
  overrides: Partial<WorkflowExecutionDependencies> = {},
): WorkflowExecutionDependencies {
  return {
    createRequestId: () => "run-memory-1",
    now: () => "2026-07-27T12:00:00.000Z",
    loadWorkflow: vi.fn(async () => ({ workflow })),
    validateDefinition: vi.fn(() => []),
    validateInput: vi.fn(() => []),
    requiresApproval: vi.fn(async () => false),
    consumeApproval: vi.fn(async () => true),
    actionFor: vi.fn(() => "run:input"),
    dispatch: vi.fn(async (request) => ({
      requestId: request.requestId,
      acceptedAt: "2026-07-27T12:00:00.000Z",
    })),
    ...overrides,
  };
}

describe("startWorkflow", () => {
  it("dispatches a provider-neutral correlated Engine request", async () => {
    const deps = dependencies();

    const result = await startWorkflow(
      {
        workflowId: "learn-from-runs",
        source: "dashboard",
        actor: "github:42",
        input: { issue: 42 },
      },
      deps,
    );

    expect(deps.dispatch).toHaveBeenCalledWith({
      requestId: "run-memory-1",
      target: { type: "workflow", id: "learn-from-runs" },
      intent: "run",
      source: "dashboard",
      input: { issue: 42 },
    });
    expect(result).toEqual({
      kind: "accepted",
      workflowId: "learn-from-runs",
      requestId: "run-memory-1",
      acceptedAt: "2026-07-27T12:00:00.000Z",
    });
  });

  it("uses the existing run id when resuming", async () => {
    const deps = dependencies();

    await startWorkflow(
      {
        workflowId: "learn-from-runs",
        source: "dashboard",
        actor: "github:42",
        requestId: "run-existing",
        resume: true,
      },
      deps,
    );

    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "run-existing" }),
    );
    expect(deps.validateInput).not.toHaveBeenCalled();
  });

  it("does not dispatch missing or invalid workflows", async () => {
    const missing = dependencies({
      loadWorkflow: vi.fn(async () => null),
    });
    const invalid = dependencies({
      validateDefinition: vi.fn(() => [
        {
          code: "bad_graph",
          message: "Workflow graph is invalid",
          path: "steps",
        },
      ]),
    });

    await expect(
      startWorkflow(
        { workflowId: "missing", source: "dashboard", actor: "github:42" },
        missing,
      ),
    ).resolves.toEqual({ kind: "not-found" });
    await expect(
      startWorkflow(
        { workflowId: "broken", source: "dashboard", actor: "github:42" },
        invalid,
      ),
    ).resolves.toEqual({
      kind: "invalid",
      issues: [
        {
          code: "bad_graph",
          message: "Workflow graph is invalid",
          path: "steps",
        },
      ],
    });
    expect(missing.dispatch).not.toHaveBeenCalled();
    expect(invalid.dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch without a server approval when one is required", async () => {
    const deps = dependencies({
      requiresApproval: vi.fn(async () => true),
    });

    await expect(
      startWorkflow(
        {
          workflowId: "learn-from-runs",
          source: "dashboard",
          actor: "github:42",
        },
        deps,
      ),
    ).resolves.toEqual({ kind: "approval-required" });
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("atomically consumes a matching approval before dispatch", async () => {
    const deps = dependencies({
      requiresApproval: vi.fn(async () => true),
    });

    await startWorkflow(
      {
        workflowId: "learn-from-runs",
        source: "dashboard",
        actor: "github:42",
        approvalId: "approval-1",
        input: { issue: 42 },
      },
      deps,
    );

    expect(deps.consumeApproval).toHaveBeenCalledWith({
      approvalId: "approval-1",
      workflowId: "learn-from-runs",
      action: "run:input",
      actor: "github:42",
      dispatchKey: "run-memory-1",
      consumedAt: "2026-07-27T12:00:00.000Z",
    });
    expect(deps.dispatch).toHaveBeenCalledOnce();
  });

  it("does not dispatch a missing, expired, mismatched, or replayed approval", async () => {
    const deps = dependencies({
      requiresApproval: vi.fn(async () => true),
      consumeApproval: vi.fn(async () => false),
    });

    await expect(
      startWorkflow(
        {
          workflowId: "learn-from-runs",
          source: "dashboard",
          actor: "github:42",
          approvalId: "approval-replayed",
        },
        deps,
      ),
    ).resolves.toEqual({ kind: "approval-required" });
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
});
