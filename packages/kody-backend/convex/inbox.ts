import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"
import { inboxEntryValidator } from "./validators"

export const list = query({
  args: { tenantId: v.string(), login: v.string() },
  handler: async (ctx, { tenantId, login }) => {
    return await ctx.db
      .query("inboxEntries")
      .withIndex("by_login", (q) => q.eq("tenantId", tenantId).eq("login", login))
      .order("desc")
      .collect()
  },
})

export const listByTenant = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db.query("inboxEntries").withIndex("by_login", (q) => q.eq("tenantId", tenantId)).collect(),
})

export const upsert = mutation({
  args: {
    tenantId: v.string(),
    login: v.string(),
    entryId: v.string(),
    entry: inboxEntryValidator,
    sentAt: v.string(),
    readAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inboxEntries")
      .withIndex("by_entry", (q) =>
        q.eq("tenantId", args.tenantId).eq("login", args.login).eq("entryId", args.entryId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        entry: args.entry,
        sentAt: args.sentAt,
        readAt: args.readAt,
      })
      return existing._id
    }
    return await ctx.db.insert("inboxEntries", args)
  },
})

export const remove = mutation({
  args: { tenantId: v.string(), login: v.string(), entryId: v.string() },
  handler: async (ctx, { tenantId, login, entryId }) => {
    const existing = await ctx.db.query("inboxEntries").withIndex("by_entry", (q) =>
      q.eq("tenantId", tenantId).eq("login", login).eq("entryId", entryId)).unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
