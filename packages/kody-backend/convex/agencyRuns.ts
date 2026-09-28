import { v } from "convex/values"
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { agencyRunSubjectTypeValidator } from "./agencyValidators"

export const list = query({
  args: { tenantId: v.string(), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) =>
    await ctx.db
      .query("agencyRuns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(Math.max(1, Math.min(limit, 200))),
})

export const get = query({
  args: { tenantId: v.string(), runId: v.string() },
  handler: async (ctx, { tenantId, runId }) =>
    await ctx.db
      .query("agencyRuns")
      .withIndex("by_run", (q) => q.eq("tenantId", tenantId).eq("runId", runId))
      .unique(),
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    subjectType: agencyRunSubjectTypeValidator,
    subjectId: v.string(),
    run: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agencyRuns")
      .withIndex("by_run", (q) => q.eq("tenantId", args.tenantId).eq("runId", args.runId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        run: args.run,
        updatedAt: args.updatedAt,
      })
      return existing._id
    }
    return await ctx.db.insert("agencyRuns", args)
  },
})
