import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

export const get = query({
  args: { tenantId: v.string(), slug: v.string() },
  handler: async (ctx, { tenantId, slug }) => {
    return await ctx.db
      .query("capabilityState")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("slug", slug))
      .unique()
  },
})

export const save = mutation({
  args: { tenantId: v.string(), slug: v.string(), state: v.any(), updatedAt: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("capabilityState")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId).eq("slug", args.slug))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { state: args.state, updatedAt: args.updatedAt })
      return existing._id
    }
    return await ctx.db.insert("capabilityState", args)
  },
})
