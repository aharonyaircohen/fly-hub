import { v } from "convex/values"
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { connectionValidator } from "./validators"

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    (
      await ctx.db
        .query("connections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect()
    ).map(({ connection }) => connection),
})

export const get = query({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, { tenantId, connectionId }) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", tenantId).eq("connection.id", connectionId),
      )
      .unique()
    return row?.connection ?? null
  },
})

export const save = mutation({
  args: { tenantId: v.string(), connection: connectionValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("connection.id", args.connection.id),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { connection: args.connection })
      return existing._id
    }
    return ctx.db.insert("connections", args)
  },
})
