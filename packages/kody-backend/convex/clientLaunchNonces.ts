import { v } from "convex/values";
import { serviceMutation } from "./lib/auth";

export const consume = serviceMutation({
  args: {
    tenantId: v.string(),
    tokenId: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query("clientLaunchNonces")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", args.now))
      .take(100);
    await Promise.all(expired.map((row) => ctx.db.delete(row._id)));

    const existing = await ctx.db
      .query("clientLaunchNonces")
      .withIndex("by_token", (q) =>
        q.eq("tenantId", args.tenantId).eq("tokenId", args.tokenId),
      )
      .unique();
    if (existing) return false;
    await ctx.db.insert("clientLaunchNonces", {
      tenantId: args.tenantId,
      tokenId: args.tokenId,
      expiresAt: args.expiresAt,
    });
    return true;
  },
});
