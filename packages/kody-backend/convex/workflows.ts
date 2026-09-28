import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"
import { workflowDefinitionValidator } from "./validators"

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("workflows")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect()
  },
})

export const get = query({
  args: { tenantId: v.string(), workflowId: v.string() },
  handler: async (ctx, { tenantId, workflowId }) => {
    return await ctx.db
      .query("workflows")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("workflowId", workflowId))
      .unique()
  },
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    workflowId: v.string(),
    definition: workflowDefinitionValidator,
    source: v.union(v.literal("local"), v.literal("store")),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("workflowId", args.workflowId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        definition: args.definition,
        source: args.source,
        updatedAt: args.updatedAt,
      })
      return existing._id
    }
    return await ctx.db.insert("workflows", args)
  },
})

export const remove = mutation({
  args: { tenantId: v.string(), workflowId: v.string() },
  handler: async (ctx, { tenantId, workflowId }) => {
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("workflowId", workflowId))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
