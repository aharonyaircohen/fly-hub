import { v } from "convex/values";
import { pipelineDefinitionValidator } from "./validators";
import { serviceMutation, serviceQuery } from "./lib/auth";

export const list = serviceQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("pipelines")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .take(500),
});

export const get = serviceQuery({
  args: { tenantId: v.string(), pipelineId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("pipelines")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("pipelineId", args.pipelineId),
      )
      .unique(),
});

export const save = serviceMutation({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    definition: pipelineDefinitionValidator,
    source: v.union(v.literal("local"), v.literal("store")),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelines")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("pipelineId", args.pipelineId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        definition: args.definition,
        source: args.source,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("pipelines", args);
  },
});

export const remove = serviceMutation({
  args: { tenantId: v.string(), pipelineId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelines")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("pipelineId", args.pipelineId),
      )
      .unique();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
