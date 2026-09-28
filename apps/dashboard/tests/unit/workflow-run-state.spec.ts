import { describe, expect, it } from "vitest";

import { normalizeWorkflowRunState } from "@dashboard/lib/workflow-run-state";

describe("normalizeWorkflowRunState", () => {
  it("preserves the exact input and output recorded for each step", () => {
    const state = normalizeWorkflowRunState({
      status: "done",
      completedStepIds: ["inspect", "repair"],
      steps: {
        inspect: {
          capability: "inspect",
          status: "completed",
          input: { request: "repair it" },
          output: { findings: "exact failure text" },
          startedAt: "2026-08-09T10:00:00.000Z",
          completedAt: "2026-08-09T10:01:00.000Z",
        },
      },
    });

    expect(state?.steps.inspect).toEqual({
      capability: "inspect",
      status: "completed",
      input: { request: "repair it" },
      output: { findings: "exact failure text" },
      startedAt: "2026-08-09T10:00:00.000Z",
      completedAt: "2026-08-09T10:01:00.000Z",
    });
  });

  it("keeps completed and blocked steps from the shared workflow state", () => {
    const state = normalizeWorkflowRunState({
      status: "blocked",
      completedStepIds: ["inspect"],
      steps: {
        inspect: {
          status: "completed",
          output: { verdict: "pass" },
          completedAt: "2026-08-09T10:01:00.000Z",
        },
        repair: {
          capability: "fix-ci",
          status: "blocked",
          output: { summary: "Repair limit reached" },
          startedAt: "2026-08-09T10:02:00.000Z",
        },
      },
    });

    expect(state?.steps).toEqual({
      inspect: {
        status: "completed",
        output: { verdict: "pass" },
        completedAt: "2026-08-09T10:01:00.000Z",
      },
      repair: {
        capability: "fix-ci",
        status: "blocked",
        output: { summary: "Repair limit reached" },
        startedAt: "2026-08-09T10:02:00.000Z",
      },
    });
  });
});

describe("workflow run state", () => {
  it("preserves a pending step approval so Dashboard can resume it", () => {
    expect(
      normalizeWorkflowRunState({
        status: "waiting-approval",
        currentStepId: "publish",
        approval: {
          stepId: "publish",
          action: "Publish Facebook post",
          contextHash: "sha256-context",
          status: "pending",
        },
      }),
    ).toMatchObject({
      status: "waiting-approval",
      approval: {
        stepId: "publish",
        action: "Publish Facebook post",
        contextHash: "sha256-context",
        status: "pending",
      },
    });
  });

  it("keeps durable progress and drops invalid values", () => {
    expect(
      normalizeWorkflowRunState({
        status: "running",
        currentStepId: "verify",
        completedStepIds: ["inspect", 3],
        transitionCounts: { "repair->inspect": 2, bad: -1 },
        facts: { releaseReady: true },
        evidence: { testsPassed: true, bad: "yes" },
        artifacts: [{ label: "PR", url: "https://example.test/pr/1" }, null],
      }),
    ).toMatchObject({
      status: "running",
      currentStepId: "verify",
      completedStepIds: ["inspect"],
      transitionCounts: { "repair->inspect": 2 },
      facts: { releaseReady: true },
      evidence: { testsPassed: true },
      artifacts: [{ label: "PR", url: "https://example.test/pr/1" }],
    });
  });
});
