import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const publicToken = (row: {
  tokenId: string;
  name: string;
  tenantId: string;
  actorLogin: string;
  actorGithubId: number;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}) => ({
  tokenId: row.tokenId,
  name: row.name,
  tenantId: row.tenantId,
  actorLogin: row.actorLogin,
  actorGithubId: row.actorGithubId,
  scopes: row.scopes,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
});

export const create = mutation({
  args: {
    tokenId: v.string(),
    tokenHash: v.string(),
    name: v.string(),
    tenantId: v.string(),
    actorLogin: v.string(),
    actorGithubId: v.number(),
    scopes: v.array(v.string()),
    createdAt: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpAccessTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (existing) throw new Error("MCP_TOKEN_HASH_EXISTS");
    await ctx.db.insert("mcpAccessTokens", args);
    return publicToken(args);
  },
});

export const authenticate = query({
  args: { tokenHash: v.string(), now: v.string() },
  handler: async (ctx, { tokenHash, now }) => {
    const row = await ctx.db
      .query("mcpAccessTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    return publicToken(row);
  },
});

export const list = query({
  args: { tenantId: v.string(), actorLogin: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mcpAccessTokens")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", args.tenantId).eq("actorLogin", args.actorLogin),
      )
      .order("desc")
      .collect();
    return rows.map(publicToken);
  },
});

export const revoke = mutation({
  args: {
    tenantId: v.string(),
    actorLogin: v.string(),
    tokenId: v.string(),
    revokedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpAccessTokens")
      .withIndex("by_token", (q) =>
        q.eq("tenantId", args.tenantId).eq("tokenId", args.tokenId),
      )
      .unique();
    if (!row || row.actorLogin !== args.actorLogin) return false;
    if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: args.revokedAt });
    return true;
  },
});
