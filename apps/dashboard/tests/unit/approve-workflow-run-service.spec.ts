import { describe, expect, it, vi } from "vitest";

import {
  approveWorkflowRun,
  type ApproveWorkflowRunDependencies,
} from "@dashboard/features/workflows/server/approve-workflow-run";

const workflow = {
  name: "Documentation Agency",
  agent: "documentation-lead",
  capabilities: ["define-documentation-brief"],
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
};

function dependencies(
  overrides: Partial<ApproveWorkflowRunDependencies> = {},
): ApproveWorkflowRunDependencies {
  return {
    verifyChallenge: vi.fn(() => ({
      approvalId: "approval-one",
      action: "run:input",
      expiresAt: "2026-07-30T10:15:00.000Z",
    })),
    loadWorkflow: vi.fn(async () => ({ workflow })),
    validateWorkflow: vi.fn(() => []),
    grantApproval: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("approveWorkflowRun", () => {
  it("validates the challenge and workflow before recording approval", async () => {
    const deps = dependencies();

    await expect(
      approveWorkflowRun(
        { workflowId: "documentation-agency", input: { issue: 42 } },
        deps,
      ),
    ).resolves.toEqual({
      kind: "approved",
      approvalId: "approval-one",
    });
    expect(deps.grantApproval).toHaveBeenCalledWith({
      approvalId: "approval-one",
      action: "run:input",
      expiresAt: "2026-07-30T10:15:00.000Z",
    });
  });

  it("never records an invalid challenge or workflow", async () => {
    const badChallenge = dependencies({
      verifyChallenge: vi.fn(() => null),
    });
    const badWorkflow = dependencies({
      validateWorkflow: vi.fn(() => [
        { code: "invalid", path: "input.issue", message: "Invalid issue" },
      ]),
    });

    await expect(
      approveWorkflowRun(
        { workflowId: "documentation-agency", input: { issue: 42 } },
        badChallenge,
      ),
    ).resolves.toEqual({ kind: "invalid-approval" });
    await expect(
      approveWorkflowRun(
        { workflowId: "documentation-agency", input: { issue: 0 } },
        badWorkflow,
      ),
    ).resolves.toMatchObject({ kind: "invalid" });
    expect(badChallenge.grantApproval).not.toHaveBeenCalled();
    expect(badWorkflow.grantApproval).not.toHaveBeenCalled();
  });
});
