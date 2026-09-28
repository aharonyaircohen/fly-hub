import { query } from "./_generated/server"
import { v } from "convex/values"
import { workflowRunStateValidator } from "./validators"
import { serviceMutation, serviceQuery } from "./lib/auth"

// DELIBERATELY PUBLIC (no requireServiceKey): the browser subscribes to this
// via ConvexProvider (useWorkflowRunStateLive) and cannot carry the service
// secret. It exposes exactly what GET /api/kody/company/workflows/:id/runs
// already served — run state scoped by (tenantId, workflowId). The optional
// serviceKey arg is accepted and ignored so the auto-injecting server client
// can call it too.
export const list = query({
  args: {
    tenantId: v.string(),
    workflowId: v.string(),
    serviceKey: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, workflowId }) => {
    return await ctx.db
      .query("workflowRuns")
      .withIndex("by_workflow", (q) => q.eq("tenantId", tenantId).eq("workflowId", workflowId))
      .take(500) // rate-bound: a workflow's run count grows slowly
  },
})

export const get = serviceQuery({
  args: { tenantId: v.string(), workflowId: v.string(), runId: v.string() },
  handler: async (ctx, { tenantId, workflowId, runId }) => {
    return await ctx.db
      .query("workflowRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", tenantId).eq("workflowId", workflowId).eq("runId", runId),
      )
      .unique()
  },
})

export const save = serviceMutation({
  args: {
    tenantId: v.string(),
    workflowId: v.string(),
    runId: v.string(),
    state: workflowRunStateValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("workflowId", args.workflowId).eq("runId", args.runId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        updatedAt: args.updatedAt,
      })
      return existing._id
    }
    return await ctx.db.insert("workflowRuns", args)
  },
})

export const approveStep = serviceMutation({
  args: {
    tenantId: v.string(),
    workflowId: v.string(),
    runId: v.string(),
    stepId: v.string(),
    contextHash: v.string(),
    approvedAt: v.string(),
    approvedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("workflowId", args.workflowId).eq("runId", args.runId),
      )
      .unique()
    const approval = existing?.state.approval
    if (
      !existing ||
      existing.state.status !== "waiting-approval" ||
      approval?.status !== "pending" ||
      approval.stepId !== args.stepId ||
      approval.contextHash !== args.contextHash
    ) {
      throw new Error("Workflow approval context changed; request a fresh approval")
    }
    await ctx.db.patch(existing._id, {
      state: {
        ...existing.state,
        status: "running",
        approval: {
          ...approval,
          status: "approved",
          approvedAt: args.approvedAt,
          approvedBy: args.approvedBy,
        },
      },
      updatedAt: args.approvedAt,
    })
    return existing._id
  },
})
