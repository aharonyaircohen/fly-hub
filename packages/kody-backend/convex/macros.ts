import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"
import { macroValidator } from "./validators"

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    return await ctx.db
      .query("macros")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect()
  },
})

export const save = mutation({
  args: { tenantId: v.string(), macroId: v.string(), macro: macroValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("macros")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId).eq("macroId", args.macroId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { macro: args.macro })
      return existing._id
    }
    return await ctx.db.insert("macros", args)
  },
})

export const remove = mutation({
  args: { tenantId: v.string(), macroId: v.string() },
  handler: async (ctx, { tenantId, macroId }) => {
    const existing = await ctx.db
      .query("macros")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("macroId", macroId))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
