import { v } from "convex/values";
import { serviceMutation } from "./lib/auth";

export const check = serviceMutation({
  args: {
    key: v.string(),
    now: v.number(),
    windowSec: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clientLaunchRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const windowStartedAt =
      Math.floor(args.now / args.windowSec) * args.windowSec;
    if (!existing) {
      await ctx.db.insert("clientLaunchRateLimits", {
        key: args.key,
        windowStartedAt,
        count: 1,
      });
      return true;
    }
    if (existing.windowStartedAt !== windowStartedAt) {
      await ctx.db.patch(existing._id, { windowStartedAt, count: 1 });
      return true;
    }
    if (existing.count >= args.limit) return false;
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return true;
  },
});
