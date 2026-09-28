import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("reports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect()
  },
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    slug: v.string(),
    runId: v.optional(v.string()),
    title: v.optional(v.string()),
    body: v.string(),
    meta: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_slug", (q) =>
        q.eq("tenantId", args.tenantId).eq("slug", args.slug).eq("runId", args.runId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        body: args.body,
        meta: args.meta,
        updatedAt: args.updatedAt,
      })
      return existing._id
    }
    return await ctx.db.insert("reports", args)
  },
})
