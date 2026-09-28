import { v } from "convex/values"
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"

export const get = query({
  args: { tenantId: v.string(), kind: v.string() },
  handler: async (ctx, { tenantId, kind }) =>
    await ctx.db
      .query("manifests")
      .withIndex("by_kind", (q) => q.eq("tenantId", tenantId).eq("kind", kind))
      .unique(),
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    kind: v.string(),
    doc: v.any(),
    updatedAt: v.string(),
    expectedUpdatedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("manifests")
      .withIndex("by_kind", (q) => q.eq("tenantId", args.tenantId).eq("kind", args.kind))
      .unique()
    if (existing) {
      if (args.expectedUpdatedAt !== undefined && existing.updatedAt !== args.expectedUpdatedAt) {
        throw new Error("Manifest changed since it was read")
      }
      await ctx.db.patch(existing._id, { doc: args.doc, updatedAt: args.updatedAt })
      return existing._id
    }
    if (args.expectedUpdatedAt !== undefined) {
      throw new Error("Manifest changed since it was read")
    }
    return await ctx.db.insert("manifests", args)
  },
})
