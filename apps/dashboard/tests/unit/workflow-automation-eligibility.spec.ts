import { beforeEach, describe, expect, it, vi } from "vitest";

const trust = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@dashboard/lib/cto/trust-store", () => ({
  readTrust: trust.read,
}));

import { workflowAutomationEligibility } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import type { WorkflowDefinition } from "@dashboard/lib/workflow-definitions";

function workflow(runWithoutApproval: boolean): WorkflowDefinition {
  return { runWithoutApproval } as WorkflowDefinition;
}

describe("workflow automation eligibility", () => {
  beforeEach(() => {
    trust.read.mockReset();
    trust.read.mockResolvedValue({ subjects: {} });
  });

  it("evaluates a collection with one trust read", async () => {
    const result = await workflowAutomationEligibility([
      { id: "safe", workflow: workflow(true) },
      { id: "guarded", workflow: workflow(false) },
    ]);

    expect(trust.read).toHaveBeenCalledOnce();
    expect(result.get("safe")).toEqual({ eligible: true });
    expect(result.get("guarded")).toEqual({
      eligible: false,
      reason: "approval-required",
    });
  });
});
