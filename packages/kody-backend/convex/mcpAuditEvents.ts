import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const outcome = v.union(
  v.literal("success"),
  v.literal("rejected"),
  v.literal("error"),
);

export const append = mutation({
  args: {
    eventId: v.string(),
    tenantId: v.string(),
    tokenId: v.string(),
    actorLogin: v.string(),
    method: v.string(),
    toolName: v.optional(v.string()),
    actionId: v.optional(v.string()),
    outcome,
    occurredAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpAuditEvents")
      .withIndex("by_event", (q) =>
        q.eq("tenantId", args.tenantId).eq("eventId", args.eventId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("mcpAuditEvents", args);
  },
});

export const list = query({
  args: { tenantId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mcpAuditEvents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 500));
  },
});
