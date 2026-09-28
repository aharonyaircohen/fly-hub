import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { query as publicQuery } from "./_generated/server"
import { v } from "convex/values"

// Reactive single-run action state for the dashboard's live subscription
// (useKodyActionState). Fires when the engine flips running/waiting.
//
// DELIBERATELY PUBLIC (no requireServiceKey): the browser subscribes via
// ConvexProvider and cannot carry the service secret. It exposes exactly what
// the polled /api/kody/action/state/[runId] endpoint already serves — one
// action-state doc keyed by its unguessable runId (same scoping model as
// chatEvents.since's sessionId). Single-doc read. The optional serviceKey arg
// is accepted and ignored so the auto-injecting server client can call it too.
export const liveGet = publicQuery({
  args: { runId: v.string(), serviceKey: v.optional(v.string()) },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("actionStates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first()
  },
})

// Global (cross-tenant) engine action state — replaces action-state.json in
// the legacy GitHub-backed Dashboard store.

export const get = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("actionStates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique()
  },
})

export const save = mutation({
  args: { runId: v.string(), state: v.any(), updatedAt: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("actionStates")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { state: args.state, updatedAt: args.updatedAt })
      return existing._id
    }
    return await ctx.db.insert("actionStates", args)
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("actionStates").collect()
  },
})

export const remove = mutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const existing = await ctx.db
      .query("actionStates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique()
    if (!existing) return false
    await ctx.db.delete(existing._id)
    return true
  },
})
