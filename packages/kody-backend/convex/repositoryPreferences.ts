import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import { v } from "convex/values";

export const get = query({
  args: { tenantId: v.string(), namespace: v.string() },
  handler: async (ctx, { tenantId, namespace }) =>
    await ctx.db
      .query("repositoryPreferences")
      .withIndex("by_repository", (q) =>
        q.eq("tenantId", tenantId).eq("namespace", namespace),
      )
      .unique(),
});

export const save = mutation({
  args: {
    tenantId: v.string(),
    namespace: v.string(),
    data: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repositoryPreferences")
      .withIndex("by_repository", (q) =>
        q.eq("tenantId", args.tenantId).eq("namespace", args.namespace),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        data: args.data,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("repositoryPreferences", args);
  },
});
