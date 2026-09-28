import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

export const list = query({
  args: { userKey: v.string() },
  handler: async (ctx, { userKey }) => {
    const rows = await ctx.db
      .query("userCredentials")
      .withIndex("by_user", (q) => q.eq("userKey", userKey))
      .collect();
    return rows.map(({ name, updatedAt }) => ({ name, updatedAt }));
  },
});

/** Server-only credential payloads for trusted host adapters. */
export const listEncrypted = query({
  args: { userKey: v.string() },
  handler: async (ctx, { userKey }) => {
    return await ctx.db
      .query("userCredentials")
      .withIndex("by_user", (q) => q.eq("userKey", userKey))
      .collect();
  },
});

export const get = query({
  args: { userKey: v.string(), name: v.string() },
  handler: async (ctx, { userKey, name }) => {
    const row = await ctx.db
      .query("userCredentials")
      .withIndex("by_user_name", (q) =>
        q.eq("userKey", userKey).eq("name", name),
      )
      .unique();
    return row
      ? { encryptedValue: row.encryptedValue, updatedAt: row.updatedAt }
      : null;
  },
});

export const upsert = mutation({
  args: {
    userKey: v.string(),
    name: v.string(),
    encryptedValue: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userCredentials")
      .withIndex("by_user_name", (q) =>
        q.eq("userKey", args.userKey).eq("name", args.name),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedValue: args.encryptedValue,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("userCredentials", args);
  },
});

export const remove = mutation({
  args: { userKey: v.string(), name: v.string() },
  handler: async (ctx, { userKey, name }) => {
    const existing = await ctx.db
      .query("userCredentials")
      .withIndex("by_user_name", (q) =>
        q.eq("userKey", userKey).eq("name", name),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return existing?._id ?? null;
  },
});
