import { describe, expect, it } from "vitest";

import {
  createWorkflowApprovalChallenge,
  verifyWorkflowApprovalChallenge,
  workflowRunAction,
} from "../src/workflow-run-approval";

const identity = {
  owner: "acme",
  repo: "docs",
  actor: "github:42",
  workflowId: "documentation-agency",
  input: { issue: 42 },
  signingKey: "server-secret",
};

describe("workflow run approvals", () => {
  it("binds a short-lived challenge to actor, repository, workflow, and input", () => {
    const challenge = createWorkflowApprovalChallenge({
      ...identity,
      approvalId: "approval-1",
      now: 1_000,
      ttlMs: 500,
    });

    expect(
      verifyWorkflowApprovalChallenge({
        ...identity,
        token: challenge.token,
        now: 1_499,
      }),
    ).toEqual({
      ...challenge,
      action: workflowRunAction({ issue: 42 }),
    });
    expect(
      verifyWorkflowApprovalChallenge({
        ...identity,
        input: { issue: 43 },
        token: challenge.token,
        now: 1_499,
      }),
    ).toBeNull();
    expect(
      verifyWorkflowApprovalChallenge({
        ...identity,
        token: challenge.token,
        now: 1_501,
      }),
    ).toBeNull();
  });
});
