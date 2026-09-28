import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("workflowRuns", () => {
  it("saves, upserts, and lists runs per workflow", async () => {
    const t = setup()
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      runId: "r1",
      state: { status: "running", completedStepIds: [] },
      updatedAt: NOW,
    })
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      runId: "r1",
      state: { status: "done", completedStepIds: ["a"] },
      updatedAt: NOW,
    })
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "other",
      runId: "r9",
      state: { status: "running", completedStepIds: [] },
      updatedAt: NOW,
    })

    const runs = await t.query(api.workflowRuns.list, { tenantId: TENANT, workflowId: "deploy" })
    expect(runs).toHaveLength(1)
    expect(runs[0].state.status).toBe("done")
  })

  it("gets a single run and returns null when missing", async () => {
    const t = setup()
    expect(
      await t.query(api.workflowRuns.get, { tenantId: TENANT, workflowId: "deploy", runId: "r1" }),
    ).toBeNull()
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "deploy",
      runId: "r1",
      state: { status: "done", completedStepIds: ["a"] },
      updatedAt: NOW,
    })
    const run = await t.query(api.workflowRuns.get, {
      tenantId: TENANT,
      workflowId: "deploy",
      runId: "r1",
    })
    expect(run?.state.completedStepIds).toEqual(["a"])
  })

  it("persists the Engine workflow input, definition, and step evidence", async () => {
    const t = setup()
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "quality-run",
      runId: "quality-1",
      state: {
        status: "running",
        input: { testId: "direct-kody-chat" },
        definitionHash: "sha256:workflow",
        currentStepId: "quality-check",
        completedStepIds: [],
        transitionCounts: {},
        steps: {
          "quality-check": {
            capability: "quality-check",
            status: "running",
            input: { targetUrl: "https://dashboard.example" },
            startedAt: NOW,
          },
        },
        facts: {},
        evidence: {},
        artifacts: [],
        usage: {
          version: 1,
          tokens: {
            input: 100,
            output: 20,
            cacheRead: 30,
            cacheCreate: 0,
            total: 150,
          },
          costUsd: 0.5,
          agentRuns: 1,
          turns: 4,
          measurement: "reported",
          byModel: {},
        },
      },
      updatedAt: NOW,
    })

    const run = await t.query(api.workflowRuns.get, {
      tenantId: TENANT,
      workflowId: "quality-run",
      runId: "quality-1",
    })
    expect(run?.state.input).toEqual({ testId: "direct-kody-chat" })
    expect(run?.state.steps?.["quality-check"]?.status).toBe("running")
    expect(run?.state.usage?.tokens.total).toBe(150)
  })

  it("persists a Workflow paused immediately before an approved step", async () => {
    const t = setup()
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "publish-facebook-content",
      runId: "publish-1",
      state: {
        status: "waiting-approval",
        currentStepId: "publish",
        completedStepIds: ["validate"],
        approval: {
          stepId: "publish",
          action: "workflow-step:publish",
          contextHash: "sha256:approved-content",
          status: "pending",
        },
      },
      updatedAt: NOW,
    })
    const run = await t.query(api.workflowRuns.get, {
      tenantId: TENANT,
      workflowId: "publish-facebook-content",
      runId: "publish-1",
    })
    expect(run?.state.status).toBe("waiting-approval")
    expect(run?.state.approval?.stepId).toBe("publish")

    await t.mutation(api.workflowRuns.approveStep, {
      tenantId: TENANT,
      workflowId: "publish-facebook-content",
      runId: "publish-1",
      stepId: "publish",
      contextHash: "sha256:approved-content",
      approvedAt: NOW,
      approvedBy: "github:123",
    })
    const approved = await t.query(api.workflowRuns.get, {
      tenantId: TENANT,
      workflowId: "publish-facebook-content",
      runId: "publish-1",
    })
    expect(approved?.state.status).toBe("running")
    expect(approved?.state.approval?.status).toBe("approved")
  })

  it("refuses a stale Workflow step approval", async () => {
    const t = setup()
    await t.mutation(api.workflowRuns.save, {
      tenantId: TENANT,
      workflowId: "publish-facebook-content",
      runId: "publish-1",
      state: {
        status: "waiting-approval",
        currentStepId: "publish",
        completedStepIds: ["validate"],
        approval: {
          stepId: "publish",
          action: "workflow-step:publish",
          contextHash: "sha256:current",
          status: "pending",
        },
      },
      updatedAt: NOW,
    })
    await expect(
      t.mutation(api.workflowRuns.approveStep, {
        tenantId: TENANT,
        workflowId: "publish-facebook-content",
        runId: "publish-1",
        stepId: "publish",
        contextHash: "sha256:stale",
        approvedAt: NOW,
        approvedBy: "github:123",
      }),
    ).rejects.toThrow(/approval context changed/i)
  })
})

describe("workflowRuns schema enforcement", () => {
  it("rejects an invalid run status", async () => {
    const t = setup()
    await expect(
      t.mutation(api.workflowRuns.save, {
        tenantId: TENANT,
        workflowId: "deploy",
        runId: "bad",
        state: { status: "exploded", completedStepIds: [] },
        updatedAt: NOW,
      }),
    ).rejects.toThrow()
  })
})
