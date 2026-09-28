import { createAgentState } from "@kody-ade/agency-domain"
import { v } from "convex/values"
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"

export const get = query({
  args: { tenantId: v.string(), agent: v.string() },
  handler: async (ctx, { tenantId, agent }) => {
    return await ctx.db
      .query("agentStates")
      .withIndex("by_agent", (q) => q.eq("tenantId", tenantId).eq("agent", agent))
      .unique()
  },
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    state: v.any(),
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, state: rawState, expectedRevision }) => {
    const state = createAgentState(rawState)
    const existing = await ctx.db
      .query("agentStates")
      .withIndex("by_agent", (q) => q.eq("tenantId", tenantId).eq("agent", state.agent))
      .unique()

    if (existing) {
      const current = createAgentState(existing.state)
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Error("Agent state changed since it was read")
      }
      if (state.revision !== current.revision + 1) {
        throw new Error("Agent state revision must advance by one")
      }
      await ctx.db.patch(existing._id, {
        state,
        updatedAt: state.updatedAt,
      })
      return existing._id
    }

    if (expectedRevision !== undefined || state.revision !== 0) {
      throw new Error("New Agent state must start at revision zero")
    }
    return await ctx.db.insert("agentStates", {
      tenantId,
      agent: state.agent,
      state,
      updatedAt: state.updatedAt,
    })
  },
})

export const reset = mutation({
  args: { tenantId: v.string(), agent: v.string() },
  handler: async (ctx, { tenantId, agent }) => {
    const existing = await ctx.db
      .query("agentStates")
      .withIndex("by_agent", (q) => q.eq("tenantId", tenantId).eq("agent", agent))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
