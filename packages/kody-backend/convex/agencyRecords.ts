import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

const kindValidator = v.union(
  v.literal("observation"),
  v.literal("finding"),
  v.literal("learning"),
)

export const list = query({
  args: { tenantId: v.string(), kind: kindValidator },
  handler: async (ctx, { tenantId, kind }) => {
    return await ctx.db
      .query("agencyRecords")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("kind", kind))
      .collect()
  },
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    kind: kindValidator,
    recordId: v.string(),
    doc: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agencyRecords")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("kind", args.kind).eq("recordId", args.recordId),
      )
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { doc: args.doc, updatedAt: args.updatedAt })
      return existing._id
    }
    return await ctx.db.insert("agencyRecords", args)
  },
})
