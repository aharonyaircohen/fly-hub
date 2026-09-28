import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth"
import { v } from "convex/values"

const category = v.union(
  v.literal("config"),
  v.literal("capability"),
  v.literal("agent"),
  v.literal("goal-template"),
  v.literal("workflow-template"),
  v.literal("capability-workflow"),
)

export const list = query({
  args: { tenantId: v.string(), category },
  handler: async (ctx, { tenantId, category }) =>
    await ctx.db
      .query("catalog")
      .withIndex("by_key", (q) => q.eq("tenantId", tenantId).eq("category", category))
      .take(500),
})

export const get = query({
  args: { tenantId: v.string(), category, slug: v.string() },
  handler: async (ctx, { tenantId, category, slug }) =>
    await ctx.db
      .query("catalog")
      .withIndex("by_key", (q) => q.eq("tenantId", tenantId).eq("category", category).eq("slug", slug))
      .unique(),
})

export const save = mutation({
  args: {
    tenantId: v.string(),
    category,
    slug: v.string(),
    doc: v.any(),
    source: v.string(),
    sourceUpdatedAt: v.optional(v.string()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("catalog")
      .withIndex("by_key", (q) => q.eq("tenantId", args.tenantId).eq("category", args.category).eq("slug", args.slug))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return existing._id
    }
    return await ctx.db.insert("catalog", args)
  },
})

export const remove = mutation({
  args: { tenantId: v.string(), category, slug: v.string() },
  handler: async (ctx, { tenantId, category, slug }) => {
    const existing = await ctx.db
      .query("catalog")
      .withIndex("by_key", (q) => q.eq("tenantId", tenantId).eq("category", category).eq("slug", slug))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})

export const clearCategories = mutation({
  args: { tenantId: v.string(), categories: v.array(category) },
  handler: async (ctx, { tenantId, categories }) => {
    const wanted = new Set(categories)
    const rows = await ctx.db
      .query("catalog")
      .withIndex("by_key", (q) => q.eq("tenantId", tenantId))
      .take(1000)
    for (const row of rows) {
      if (wanted.has(row.category)) await ctx.db.delete(row._id)
    }
  },
})
