import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const desiredStatus = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("deleted"),
);
const observedStatus = v.union(
  v.literal("provisioning"),
  v.literal("deploying"),
  v.literal("running"),
  v.literal("sleeping"),
  v.literal("stopped"),
  v.literal("unhealthy"),
  v.literal("failed"),
  v.literal("deleting"),
  v.literal("deleted"),
);
const exposure = v.union(v.literal("private"), v.literal("public"));
const accessToken = v.object({
  tokenId: v.string(),
  name: v.string(),
  tokenHash: v.string(),
  createdAt: v.string(),
  lastUsedAt: v.optional(v.string()),
  revokedAt: v.optional(v.string()),
});

const transitions: Record<string, ReadonlySet<string>> = {
  provisioning: new Set(["deploying", "running", "failed", "deleting"]),
  deploying: new Set(["running", "unhealthy", "failed", "deleting"]),
  running: new Set([
    "deploying",
    "sleeping",
    "stopped",
    "unhealthy",
    "deleting",
  ]),
  sleeping: new Set(["running", "stopped", "unhealthy", "deleting"]),
  stopped: new Set(["deploying", "running", "deleting"]),
  unhealthy: new Set(["deploying", "running", "stopped", "failed", "deleting"]),
  // Reconciliation may observe a healthy Machine after a delayed callback or
  // a manual provider recovery, so physical recovery can clear a stale failure.
  failed: new Set(["deploying", "running", "deleting"]),
  deleting: new Set(["deleted", "failed"]),
  deleted: new Set(),
};

export const list = query({
  args: { tenantId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("apps")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect(),
});

export const get = query({
  args: { tenantId: v.string(), slug: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("apps")
      .withIndex("by_slug", (q) =>
        q.eq("tenantId", args.tenantId).eq("slug", args.slug),
      )
      .unique(),
});

export const getById = query({
  args: { tenantId: v.string(), appId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique(),
});

export const create = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    name: v.string(),
    slug: v.string(),
    repository: v.string(),
    branch: v.string(),
    rootDirectory: v.string(),
    detectedConfig: v.any(),
    desiredStatus,
    observedStatus,
    provider: v.any(),
    exposure,
    accessTokens: v.array(accessToken),
    currentDeploymentId: v.optional(v.string()),
    secretNames: v.array(v.string()),
    domains: v.array(v.any()),
    storage: v.array(v.any()),
    createdBy: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const duplicate = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) =>
        q.eq("tenantId", args.tenantId).eq("slug", args.slug),
      )
      .unique();
    if (duplicate) throw new Error("APP_SLUG_EXISTS");
    return await ctx.db.insert("apps", args);
  },
});

export const transition = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    observedStatus,
    desiredStatus: v.optional(desiredStatus),
    currentDeploymentId: v.optional(v.string()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    if (
      app.observedStatus !== args.observedStatus &&
      !transitions[app.observedStatus]?.has(args.observedStatus)
    ) {
      throw new Error("INVALID_APP_TRANSITION");
    }
    const { tenantId: _tenantId, appId: _appId, ...patch } = args;
    await ctx.db.patch(app._id, patch);
    return app._id;
  },
});

export const setExposure = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    exposure,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    await ctx.db.patch(app._id, {
      exposure: args.exposure,
      updatedAt: args.updatedAt,
    });
    return app._id;
  },
});

export const patch = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    name: v.optional(v.string()),
    branch: v.optional(v.string()),
    rootDirectory: v.optional(v.string()),
    detectedConfig: v.optional(v.any()),
    provider: v.optional(v.any()),
    currentDeploymentId: v.optional(v.string()),
    secretNames: v.optional(v.array(v.string())),
    domains: v.optional(v.array(v.any())),
    storage: v.optional(v.array(v.any())),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    const { tenantId: _tenantId, appId: _appId, ...values } = args;
    await ctx.db.patch(app._id, values);
    return app._id;
  },
});

export const beginAction = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    requestId: v.string(),
    action: v.string(),
    startedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    if (app.currentAction?.requestId === args.requestId) return app._id;
    if (app.currentAction) throw new Error("APP_ACTION_CONFLICT");
    await ctx.db.patch(app._id, {
      currentAction: {
        requestId: args.requestId,
        action: args.action,
        startedAt: args.startedAt,
      },
      updatedAt: args.startedAt,
    });
    return app._id;
  },
});

export const endAction = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    requestId: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    if (app.currentAction?.requestId !== args.requestId) return app._id;
    await ctx.db.patch(app._id, {
      currentAction: undefined,
      updatedAt: args.updatedAt,
    });
    return app._id;
  },
});

export const addAccessToken = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    token: accessToken,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    if (app.accessTokens.some((token) => token.tokenId === args.token.tokenId))
      return app._id;
    await ctx.db.patch(app._id, {
      accessTokens: [...app.accessTokens, args.token],
      updatedAt: args.updatedAt,
    });
    return app._id;
  },
});

export const revokeAccessToken = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    tokenId: v.string(),
    revokedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const app = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .unique();
    if (!app) throw new Error("APP_NOT_FOUND");
    const accessTokens = app.accessTokens.map((token) =>
      token.tokenId === args.tokenId
        ? { ...token, revokedAt: args.revokedAt }
        : token,
    );
    if (!accessTokens.some((token) => token.tokenId === args.tokenId))
      throw new Error("APP_ACCESS_TOKEN_NOT_FOUND");
    await ctx.db.patch(app._id, { accessTokens, updatedAt: args.revokedAt });
    return app._id;
  },
});
