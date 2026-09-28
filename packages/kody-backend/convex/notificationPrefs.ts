import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

export const get = query({
  args: { tenantId: v.string(), login: v.string() },
  handler: async (ctx, { tenantId, login }) => {
    return await ctx.db
      .query("notificationPrefs")
      .withIndex("by_login", (q) => q.eq("tenantId", tenantId).eq("login", login))
      .unique()
  },
})

export const save = mutation({
  args: { tenantId: v.string(), login: v.string(), prefs: v.any(), updatedAt: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_login", (q) => q.eq("tenantId", args.tenantId).eq("login", args.login))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { prefs: args.prefs, updatedAt: args.updatedAt })
      return existing._id
    }
    return await ctx.db.insert("notificationPrefs", args)
  },
})
