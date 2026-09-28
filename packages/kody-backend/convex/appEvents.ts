import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

export const list = query({
  args: { tenantId: v.string(), appId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("appEvents")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .collect(),
});

export const append = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    eventId: v.string(),
    kind: v.string(),
    actor: v.any(),
    payload: v.any(),
    timestamp: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appEvents")
      .withIndex("by_event", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("appId", args.appId)
          .eq("eventId", args.eventId),
      )
      .unique();
    return existing?._id ?? (await ctx.db.insert("appEvents", args));
  },
});
