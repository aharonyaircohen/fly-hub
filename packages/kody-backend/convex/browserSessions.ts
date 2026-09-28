import { v } from "convex/values";

import type { QueryCtx, MutationCtx } from "./_generated/server";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const identityArgs = {
  tenantId: v.string(),
  actorId: v.string(),
  sessionId: v.string(),
};

const stateValidator = v.union(
  v.literal("starting"),
  v.literal("running"),
  v.literal("suspended"),
  v.literal("failed"),
);

async function findSession(
  ctx: QueryCtx | MutationCtx,
  args: { tenantId: string; actorId: string; sessionId: string },
) {
  return await ctx.db
    .query("browserSessions")
    .withIndex("by_session", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("actorId", args.actorId)
        .eq("sessionId", args.sessionId),
    )
    .unique();
}

export const get = query({
  args: identityArgs,
  handler: findSession,
});

export const getActive = query({
  args: { tenantId: v.string(), actorId: v.string(), nowMs: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("browserSessions")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", args.tenantId).eq("actorId", args.actorId),
      )
      .unique();
    if (!session || session.expiresAtMs <= args.nowMs) return null;
    return session;
  },
});

export const acquireStartLease = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    ownerId: v.string(),
    nowMs: v.number(),
    leaseUntilMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("browserSessionStartLeases")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", args.tenantId).eq("actorId", args.actorId),
      )
      .unique();
    if (
      existing &&
      existing.ownerId !== args.ownerId &&
      existing.leaseUntilMs > args.nowMs
    ) {
      return false;
    }
    const value = {
      tenantId: args.tenantId,
      actorId: args.actorId,
      ownerId: args.ownerId,
      leaseUntilMs: args.leaseUntilMs,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("browserSessionStartLeases", value);
    return true;
  },
});

export const releaseStartLease = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("browserSessionStartLeases")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", args.tenantId).eq("actorId", args.actorId),
      )
      .unique();
    if (!existing || existing.ownerId !== args.ownerId) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

export const save = mutation({
  args: {
    ...identityArgs,
    providerId: v.string(),
    appName: v.string(),
    machineId: v.string(),
    state: stateValidator,
    currentUrl: v.string(),
    viewport: v.object({ width: v.number(), height: v.number() }),
    nowMs: v.number(),
    expiresAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("browserSessions")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", args.tenantId).eq("actorId", args.actorId),
      )
      .unique();
    const value = {
      tenantId: args.tenantId,
      actorId: args.actorId,
      sessionId: args.sessionId,
      providerId: args.providerId,
      appName: args.appName,
      machineId: args.machineId,
      state: args.state,
      currentUrl: args.currentUrl,
      viewport: args.viewport,
      lastActiveAtMs: args.nowMs,
      expiresAtMs: args.expiresAtMs,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("browserSessions", {
      ...value,
      createdAtMs: args.nowMs,
    });
  },
});

export const touch = mutation({
  args: {
    ...identityArgs,
    nowMs: v.number(),
    expiresAtMs: v.number(),
    currentUrl: v.optional(v.string()),
    state: v.optional(stateValidator),
    viewport: v.optional(v.object({ width: v.number(), height: v.number() })),
  },
  handler: async (ctx, args) => {
    const session = await findSession(ctx, args);
    if (!session) return false;
    await ctx.db.patch(session._id, {
      lastActiveAtMs: args.nowMs,
      expiresAtMs: args.expiresAtMs,
      ...(args.currentUrl !== undefined ? { currentUrl: args.currentUrl } : {}),
      ...(args.state !== undefined ? { state: args.state } : {}),
      ...(args.viewport !== undefined ? { viewport: args.viewport } : {}),
    });
    return true;
  },
});

export const close = mutation({
  args: { ...identityArgs, nowMs: v.number() },
  handler: async (ctx, args) => {
    void args.nowMs;
    const session = await findSession(ctx, args);
    if (!session) return false;
    await ctx.db.delete(session._id);
    return true;
  },
});
