import { describe, expect, it } from "vitest";

import {
  createWorkflowRunApproval,
  readWorkflowRunApprovalToken,
} from "../../app/api/kody/chat/tools/workflow-run-approval";

describe("Chat workflow approval view", () => {
  it("renders the server challenge and returns it only for an approve click", () => {
    const directive = createWorkflowRunApproval({
      owner: "acme",
      repo: "app",
      workflowId: "documentation-agency",
      workflowInput: { issue: 42 },
      approvalToken: "server.challenge",
    });
    expect(directive.id).toBe("server.challenge");

    const result = {
      kind: "view_result",
      view: "renderer",
      viewId: directive.id,
      rendererSlug: "approval-card",
      actionId: "approve",
    };
    expect(
      readWorkflowRunApprovalToken(
        `<view_result>${JSON.stringify(result)}</view_result>`,
      ),
    ).toBe("server.challenge");
    expect(
      readWorkflowRunApprovalToken(
        `<view_result>${JSON.stringify({
          ...result,
          actionId: "cancel",
        })}</view_result>`,
      ),
    ).toBeNull();
  });

  it("renders decision context for a workflow approval", () => {
    const directive = createWorkflowRunApproval({
      owner: "acme",
      repo: "app",
      workflowId: "repair-branch",
      workflowInput: { issue: 23 },
      approvalToken: "server.challenge",
      decisionContext: {
        currentState: "The existing pull request is waiting on a repair run.",
        whyNow: "The failed check blocks review from continuing.",
        recommendedAction: "Run the repair against the existing pull request.",
        cancelChoice: "Leave the pull request unchanged for now.",
      },
    });

    const body = String((directive.data as { body?: string }).body ?? "");
    expect(body).toContain("**Current:** The existing pull request");
    expect(body).toContain("**Why:** The failed check blocks review");
    expect(body).toContain("**Approving will:** Run the repair");
    expect(body).toContain(
      "**Cancelling will:** Leave the pull request unchanged",
    );
  });
});
