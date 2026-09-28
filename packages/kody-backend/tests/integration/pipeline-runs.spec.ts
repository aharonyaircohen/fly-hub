import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const NOW = "2026-08-08T00:00:00.000Z";

describe("pipeline runs", () => {
  it("runs one Pipeline and keeps only the newest waiting run per key", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      concurrencyKey: "main",
      facts: { branch: "main" },
      steps: [
        { id: "repair", workflowId: "ci-repair", status: "pending" as const },
      ],
      now: NOW,
    };

    const first = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "repair-1",
    });
    const competing = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "repair-2",
    });
    const newest = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "repair-3",
      facts: { branch: "main", ciRunId: 3 },
    });
    const otherBranch = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "repair-feature",
      concurrencyKey: "feature",
      facts: { branch: "feature" },
    });

    expect(first.claimed).toBe(true);
    expect(competing.claimed).toBe(false);
    expect(competing.queued).toBe(true);
    expect(competing.run?.status).toBe("queued");
    expect(newest.claimed).toBe(false);
    expect(newest.queued).toBe(true);
    expect(newest.run?.runId).toBe("repair-3");
    const superseded = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "repair-2",
    });
    expect(superseded?.status).toBe("cancelled");
    expect(otherBranch.claimed).toBe(true);
  });

  it("starts the waiting run when the active run finishes", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      concurrencyKey: "main",
      steps: [
        { id: "repair", workflowId: "ci-repair", status: "pending" as const },
      ],
      now: NOW,
    };
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "active-repair",
      facts: { branch: "main", ciRunId: 1 },
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "active-repair",
      stepIndex: 0,
      workflowRunId: "active-workflow",
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "waiting-repair",
      facts: { branch: "main", ciRunId: 2 },
    });

    const result = await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "active-workflow",
      status: "success",
      output: {},
      now: NOW,
    });

    expect(result).toMatchObject({
      kind: "start",
      pipelineId: "ci-repair",
      runId: "waiting-repair",
      stepIndex: 0,
      facts: { branch: "main", ciRunId: 2 },
    });
    const waiting = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "waiting-repair",
    });
    expect(waiting?.status).toBe("running");
  });

  it("starts the waiting run when the active workflow fails", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      concurrencyKey: "main",
      steps: [
        { id: "repair", workflowId: "ci-repair", status: "pending" as const },
      ],
      now: NOW,
    };
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "active-repair",
      facts: { branch: "main", ciRunId: 1 },
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "active-repair",
      stepIndex: 0,
      workflowRunId: "active-workflow",
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "waiting-repair",
      facts: { branch: "main", ciRunId: 2 },
    });

    const next = await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "active-workflow",
      status: "failed",
      output: {},
      now: "2026-08-08T00:01:00.000Z",
    });

    expect(next).toMatchObject({
      kind: "start",
      runId: "waiting-repair",
      facts: { branch: "main", ciRunId: 2 },
    });
    const active = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "active-repair",
    });
    const waiting = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "waiting-repair",
    });
    expect(active?.status).toBe("failed");
    expect(waiting?.status).toBe("running");
  });

  it("starts the waiting run when the active dispatch fails", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      concurrencyKey: "main",
      facts: { branch: "main" },
      steps: [
        { id: "repair", workflowId: "ci-repair", status: "pending" as const },
      ],
      now: NOW,
    };
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "active-repair",
    });
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "waiting-repair",
      facts: { branch: "main", ciRunId: 2 },
    });

    const result = await t.mutation(api.pipelineRuns.failDispatch, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "active-repair",
      error: "dispatch failed",
      now: NOW,
    });

    expect(result).toMatchObject({
      kind: "start",
      runId: "waiting-repair",
      facts: { branch: "main", ciRunId: 2 },
    });
  });

  it("releases a concurrency key held by an abandoned run", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      concurrencyKey: "main",
      facts: { branch: "main" },
      steps: [
        { id: "repair", workflowId: "ci-repair", status: "pending" as const },
      ],
    };
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "abandoned-repair",
      now: "2026-08-08T00:00:00.000Z",
    });

    const replacement = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "replacement-repair",
      now: "2026-08-08T08:00:00.000Z",
    });

    expect(replacement.claimed).toBe(true);
    const abandoned = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "ci-repair",
      runId: "abandoned-repair",
    });
    expect(abandoned?.status).toBe("failed");
    expect(abandoned?.error).toBe("Pipeline run expired while still active.");
  });

  it("reserves once, advances in order, and ignores duplicate completions", async () => {
    const t = setup();
    const args = {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-1",
      facts: { pr: 42 },
      steps: [
        {
          id: "review",
          workflowId: "review-fix",
          status: "pending" as const,
        },
        { id: "merge", workflowId: "merge", status: "pending" as const },
      ],
      now: NOW,
    };

    const first = await t.mutation(api.pipelineRuns.reserve, args);
    const duplicate = await t.mutation(api.pipelineRuns.reserve, args);
    expect(first.claimed).toBe(true);
    expect(duplicate.claimed).toBe(false);

    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: args.pipelineId,
      runId: args.runId,
      stepIndex: 0,
      workflowRunId: "workflow-run-1",
      now: NOW,
    });
    const next = await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "workflow-run-1",
      status: "success",
      output: { pr: 42, headSha: "abc" },
      now: NOW,
    });
    expect(next).toMatchObject({
      kind: "next",
      stepIndex: 1,
      facts: { pr: 42, headSha: "abc" },
    });
    const advanced = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: args.pipelineId,
      runId: args.runId,
    });
    expect(advanced?.facts).toEqual({ pr: 42, headSha: "abc" });
    await expect(
      t.mutation(api.pipelineRuns.advance, {
        tenantId: TENANT,
        workflowRunId: "workflow-run-1",
        status: "success",
        output: {},
        now: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("stops the Pipeline when a child Workflow fails", async () => {
    const t = setup();
    await t.mutation(api.pipelineRuns.reserve, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-failed",
      facts: { pr: 42 },
      steps: [{ id: "review", workflowId: "review-fix", status: "pending" }],
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-failed",
      stepIndex: 0,
      workflowRunId: "workflow-run-failed",
      now: NOW,
    });

    const result = await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "workflow-run-failed",
      status: "failed",
      output: {},
      now: NOW,
    });
    expect(result).toEqual({ kind: "failed" });
    const run = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-failed",
    });
    expect(run?.status).toBe("failed");
    expect(run?.steps[0]?.status).toBe("failed");
  });

  it("marks a Pipeline blocked instead of leaving it running forever", async () => {
    const t = setup();
    await t.mutation(api.pipelineRuns.reserve, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-blocked",
      facts: { pr: 42 },
      steps: [{ id: "review", workflowId: "review-fix", status: "pending" }],
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-blocked",
      stepIndex: 0,
      workflowRunId: "workflow-run-blocked",
      now: NOW,
    });

    await expect(
      t.mutation(api.pipelineRuns.advance, {
        tenantId: TENANT,
        workflowRunId: "workflow-run-blocked",
        status: "blocked",
        output: {},
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "blocked" });
    const run = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "review-and-merge",
      runId: "run-blocked",
    });
    expect(run?.status).toBe("blocked");
  });

  it("stops cleanly when a decision step returns stop", async () => {
    const t = setup();
    await t.mutation(api.pipelineRuns.reserve, {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      runId: "qa-stop",
      steps: [
        {
          id: "issues",
          workflowId: "qa-issue-sync",
          decisionFact: "deliveryDecision",
          status: "pending",
        },
        { id: "fix", workflowId: "qa-fix", status: "pending" },
      ],
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      runId: "qa-stop",
      stepIndex: 0,
      workflowRunId: "qa-sync-stop",
      now: NOW,
    });

    await expect(
      t.mutation(api.pipelineRuns.advance, {
        tenantId: TENANT,
        workflowRunId: "qa-sync-stop",
        status: "success",
        output: { deliveryDecision: "stop" },
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "done" });
    const run = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      runId: "qa-stop",
    });
    expect(run?.status).toBe("done");
    expect(run?.steps[1]?.status).toBe("cancelled");
  });

  it("waits for approval and resumes or rejects exactly once", async () => {
    const t = setup();
    const reserve = async (runId: string, workflowRunId: string) => {
      await t.mutation(api.pipelineRuns.reserve, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId,
        steps: [
          {
            id: "issues",
            workflowId: "qa-issue-sync",
            decisionFact: "deliveryDecision",
            status: "pending",
          },
          { id: "fix", workflowId: "qa-fix", status: "pending" },
        ],
        now: NOW,
      });
      await t.mutation(api.pipelineRuns.markDispatched, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId,
        stepIndex: 0,
        workflowRunId,
        now: NOW,
      });
      await t.mutation(api.pipelineRuns.advance, {
        tenantId: TENANT,
        workflowRunId,
        status: "success",
        output: { deliveryDecision: "approval", issue: 42 },
        now: NOW,
      });
    };

    await reserve("qa-approve", "qa-sync-approve");
    await expect(
      t.mutation(api.pipelineRuns.decide, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: "qa-approve",
        decision: "approve",
        decidedBy: "alice",
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "next", stepIndex: 1 });
    await expect(
      t.mutation(api.pipelineRuns.decide, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: "qa-approve",
        decision: "approve",
        decidedBy: "alice",
        now: NOW,
      }),
    ).resolves.toBeNull();

    await reserve("qa-reject", "qa-sync-reject");
    await expect(
      t.mutation(api.pipelineRuns.decide, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: "qa-reject",
        decision: "reject",
        decidedBy: "alice",
        now: NOW,
      }),
    ).resolves.toEqual({ kind: "rejected", next: null });
    const rejected = await t.query(api.pipelineRuns.get, {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      runId: "qa-reject",
    });
    expect(rejected?.status).toBe("cancelled");
    expect(rejected?.steps[1]?.status).toBe("cancelled");
  });

  it("keeps the concurrency key while approval is waiting", async () => {
    const t = setup();
    const common = {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      concurrencyKey: "production",
      steps: [
        {
          id: "issues",
          workflowId: "qa-issue-sync",
          decisionFact: "deliveryDecision",
          status: "pending" as const,
        },
        { id: "fix", workflowId: "qa-fix", status: "pending" as const },
      ],
      now: NOW,
    };
    await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "qa-active",
    });
    await t.mutation(api.pipelineRuns.markDispatched, {
      tenantId: TENANT,
      pipelineId: "qa-maintenance",
      runId: "qa-active",
      stepIndex: 0,
      workflowRunId: "qa-sync-active",
      now: NOW,
    });
    await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "qa-sync-active",
      status: "success",
      output: { deliveryDecision: "approval", issue: 42 },
      now: NOW,
    });

    const next = await t.mutation(api.pipelineRuns.reserve, {
      ...common,
      runId: "qa-newest",
    });

    expect(next.claimed).toBe(false);
    expect(next.queued).toBe(true);
  });

  it("starts the newest waiting run after stop or rejection", async () => {
    const t = setup();
    const steps = [
      {
        id: "issues",
        workflowId: "qa-issue-sync",
        decisionFact: "deliveryDecision",
        status: "pending" as const,
      },
      { id: "fix", workflowId: "qa-fix", status: "pending" as const },
    ];
    const reservePair = async (suffix: string) => {
      await t.mutation(api.pipelineRuns.reserve, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: `active-${suffix}`,
        concurrencyKey: suffix,
        steps,
        now: NOW,
      });
      await t.mutation(api.pipelineRuns.markDispatched, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: `active-${suffix}`,
        stepIndex: 0,
        workflowRunId: `sync-${suffix}`,
        now: NOW,
      });
      await t.mutation(api.pipelineRuns.reserve, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: `waiting-${suffix}`,
        concurrencyKey: suffix,
        steps,
        now: NOW,
      });
    };

    await reservePair("stop");
    await expect(
      t.mutation(api.pipelineRuns.advance, {
        tenantId: TENANT,
        workflowRunId: "sync-stop",
        status: "success",
        output: { deliveryDecision: "stop" },
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: "start", runId: "waiting-stop" });

    await reservePair("reject");
    await t.mutation(api.pipelineRuns.advance, {
      tenantId: TENANT,
      workflowRunId: "sync-reject",
      status: "success",
      output: { deliveryDecision: "approval", issue: 42 },
      now: NOW,
    });
    await expect(
      t.mutation(api.pipelineRuns.decide, {
        tenantId: TENANT,
        pipelineId: "qa-maintenance",
        runId: "active-reject",
        decision: "reject",
        decidedBy: "alice",
        now: NOW,
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      next: { kind: "start", runId: "waiting-reject" },
    });
  });
});

it("promotes queued work after a final-step approval decision exactly once", async () => {
  const t = setup();
  const common = {
    tenantId: TENANT,
    pipelineId: "pipeline",
    concurrencyKey: "main",
    steps: [
      {
        id: "final",
        workflowId: "work",
        decisionFact: "decision",
        status: "pending" as const,
      },
    ],
    now: NOW,
  };
  await t.mutation(api.pipelineRuns.reserve, { ...common, runId: "active" });
  await t.mutation(api.pipelineRuns.markDispatched, {
    tenantId: TENANT,
    pipelineId: "pipeline",
    runId: "active",
    stepIndex: 0,
    workflowRunId: "work-run",
    now: NOW,
  });
  await t.mutation(api.pipelineRuns.reserve, { ...common, runId: "waiting" });
  const args = {
    tenantId: TENANT,
    workflowRunId: "work-run",
    status: "success" as const,
    output: { decision: "approval" },
    now: NOW,
  };
  expect(await t.mutation(api.pipelineRuns.advance, args)).toMatchObject({
    kind: "start",
    runId: "waiting",
    stepIndex: 0,
  });
  expect(
    (
      await t.query(api.pipelineRuns.get, {
        tenantId: TENANT,
        pipelineId: "pipeline",
        runId: "waiting",
      })
    )?.status,
  ).toBe("running");
  expect(await t.mutation(api.pipelineRuns.advance, args)).toBeNull();
});
