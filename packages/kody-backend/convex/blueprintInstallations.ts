import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import { v } from "convex/values";

const status = v.union(
  v.literal("installing"),
  v.literal("active"),
  v.literal("blocked"),
);

export const get = query({
  args: { tenantId: v.string(), blueprintId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("blueprintInstallations")
      .withIndex("by_blueprint", (q) =>
        q.eq("tenantId", args.tenantId).eq("blueprintId", args.blueprintId),
      )
      .unique(),
});

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("blueprintInstallations")
      .withIndex("by_blueprint", (q) => q.eq("tenantId", args.tenantId))
      .collect(),
});

export const save = mutation({
  args: {
    tenantId: v.string(),
    blueprintId: v.string(),
    blueprintVersion: v.string(),
    status,
    requestId: v.string(),
    maintainerId: v.optional(v.string()),
    evidence: v.array(v.string()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("blueprintInstallations")
      .withIndex("by_blueprint", (q) =>
        q.eq("tenantId", args.tenantId).eq("blueprintId", args.blueprintId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("blueprintInstallations", args);
  },
});
