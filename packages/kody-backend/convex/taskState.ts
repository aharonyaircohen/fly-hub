import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

export const list = query({
  args: { tenantId: v.string(), taskKey: v.string() },
  handler: async (ctx, { tenantId, taskKey }) => {
    return await ctx.db
      .query("taskState")
      .withIndex("by_task", (q) => q.eq("tenantId", tenantId).eq("taskKey", taskKey))
      .collect()
  },
})

export const get = query({
  args: { tenantId: v.string(), taskKey: v.string(), kind: v.string() },
  handler: async (ctx, { tenantId, taskKey, kind }) => {
    return await ctx.db
      .query("taskState")
      .withIndex("by_task", (q) =>
        q.eq("tenantId", tenantId).eq("taskKey", taskKey).eq("kind", kind),
      )
      .unique()
  },
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    taskKey: v.string(),
    kind: v.string(),
    doc: v.any(),
    updatedAt: v.string(),
    expectedUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("taskState")
      .withIndex("by_task", (q) =>
        q.eq("tenantId", args.tenantId).eq("taskKey", args.taskKey).eq("kind", args.kind),
      )
      .unique()
    if (existing) {
      if (args.expectedUpdatedAt !== undefined && existing.updatedAt !== args.expectedUpdatedAt) {
        throw new Error("Task state changed since it was read")
      }
      await ctx.db.patch(existing._id, { doc: args.doc, updatedAt: args.updatedAt })
      return existing._id
    }
    return await ctx.db.insert("taskState", args)
  },
})
