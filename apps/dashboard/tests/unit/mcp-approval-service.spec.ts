import { describe, expect, it, vi } from "vitest";
import { decideMcpApprovalRequest } from "@dashboard/lib/mcp/approval-service";

const pending = {
  tenantId: "acme/widgets",
  requestId: "request-1",
  workRecordId: "phase-4",
  targetKind: "workflow" as const,
  workflowId: "quality-run",
  runId: "run-1",
  mode: "start" as const,
  input: {},
  action: "run:hash",
  approvalId: "approval-1",
  approvalToken: "signed-token",
  actor: {
    tokenId: "token-1",
    name: "Codex",
    actorLogin: "octocat",
    actorGithubId: 42,
  },
  status: "approving" as const,
};

describe("MCP approval decision", () => {
  it("approves and dispatches a workflow exactly once", async () => {
    const dependencies = {
      claimDecision: vi.fn().mockResolvedValue(pending),
      dispatchWorkflow: vi.fn().mockResolvedValue({
        runId: "run-1",
        execution: "kody-engine",
      }),
      dispatchCapability: vi.fn(),
      dispatchAutomation: vi.fn(),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      decideMcpApprovalRequest(
        {
          tenantId: "acme/widgets",
          requestId: "request-1",
          decision: "approved",
          decidedBy: "github:42",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ status: "dispatched", runId: "run-1" });
    expect(dependencies.dispatchWorkflow).toHaveBeenCalledWith(pending);
    expect(dependencies.dispatchCapability).not.toHaveBeenCalled();
    expect(dependencies.finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dispatched" }),
    );
  });

  it("records rejection without dispatching repository work", async () => {
    const dependencies = {
      claimDecision: vi.fn().mockResolvedValue({
        ...pending,
        status: "rejected",
      }),
      dispatchWorkflow: vi.fn(),
      dispatchCapability: vi.fn(),
      dispatchAutomation: vi.fn(),
      finish: vi.fn(),
    };
    await expect(
      decideMcpApprovalRequest(
        {
          tenantId: "acme/widgets",
          requestId: "request-1",
          decision: "rejected",
          decidedBy: "github:42",
        },
        dependencies,
      ),
    ).resolves.toEqual({ requestId: "request-1", status: "rejected" });
    expect(dependencies.dispatchWorkflow).not.toHaveBeenCalled();
    expect(dependencies.finish).not.toHaveBeenCalled();
  });

  it("fails closed when a request was already decided or expired", async () => {
    const dependencies = {
      claimDecision: vi.fn().mockResolvedValue(null),
      dispatchWorkflow: vi.fn(),
      dispatchCapability: vi.fn(),
      dispatchAutomation: vi.fn(),
      finish: vi.fn(),
    };
    await expect(
      decideMcpApprovalRequest(
        {
          tenantId: "acme/widgets",
          requestId: "request-1",
          decision: "approved",
          decidedBy: "github:42",
        },
        dependencies,
      ),
    ).rejects.toThrow("Approval request is unavailable");
  });

  it("applies an approved online automation configuration", async () => {
    const automation = {
      ...pending,
      targetKind: "automation" as const,
      action: "schedule.save",
      workflowId: "daily-health",
      input: { schedule: { id: "daily-health" } },
    };
    const dependencies = {
      claimDecision: vi.fn().mockResolvedValue(automation),
      dispatchWorkflow: vi.fn(),
      dispatchCapability: vi.fn(),
      dispatchAutomation: vi.fn().mockResolvedValue({
        execution: "kody-online",
        automationId: "daily-health",
      }),
      finish: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      decideMcpApprovalRequest(
        {
          tenantId: "acme/widgets",
          requestId: "request-1",
          decision: "approved",
          decidedBy: "github:42",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      status: "dispatched",
      execution: "kody-online",
    });
    expect(dependencies.dispatchAutomation).toHaveBeenCalledWith(automation);
    expect(dependencies.dispatchWorkflow).not.toHaveBeenCalled();
    expect(dependencies.dispatchCapability).not.toHaveBeenCalled();
  });
});
