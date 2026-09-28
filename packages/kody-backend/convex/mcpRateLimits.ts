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
    const row = await ctx.db
      .query("mcpRateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const windowStartedAt =
      Math.floor(args.now / args.windowSec) * args.windowSec;
    if (!row) {
      await ctx.db.insert("mcpRateLimits", {
        key: args.key,
        windowStartedAt,
        count: 1,
      });
      return true;
    }
    if (row.windowStartedAt !== windowStartedAt) {
      await ctx.db.patch(row._id, { windowStartedAt, count: 1 });
      return true;
    }
    if (row.count >= args.limit) return false;
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return true;
  },
});
