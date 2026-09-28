import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const status = v.union(
  v.literal("queued"),
  v.literal("building"),
  v.literal("releasing"),
  v.literal("verifying"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("superseded"),
  v.literal("rolled_back"),
);

export const list = query({
  args: { tenantId: v.string(), appId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("appDeployments")
      .withIndex("by_app", (q) =>
        q.eq("tenantId", args.tenantId).eq("appId", args.appId),
      )
      .order("desc")
      .collect(),
});

export const get = query({
  args: { tenantId: v.string(), appId: v.string(), deploymentId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("appDeployments")
      .withIndex("by_deployment", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("appId", args.appId)
          .eq("deploymentId", args.deploymentId),
      )
      .unique(),
});

export const getByRequest = query({
  args: { tenantId: v.string(), requestId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("appDeployments")
      .withIndex("by_tenant_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique(),
});

export const reserve = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    deploymentId: v.string(),
    requestId: v.string(),
    commitSha: v.string(),
    buildPlan: v.any(),
    imageRef: v.optional(v.string()),
    builderMachineId: v.optional(v.string()),
    runtimeMachineId: v.optional(v.string()),
    status,
    stages: v.array(v.any()),
    error: v.optional(v.any()),
    requestedBy: v.string(),
    callbackTokenHash: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
    completedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appDeployments")
      .withIndex("by_request", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("appId", args.appId)
          .eq("requestId", args.requestId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("appDeployments", args);
  },
});

export const update = mutation({
  args: {
    tenantId: v.string(),
    appId: v.string(),
    deploymentId: v.string(),
    status: v.optional(status),
    stages: v.optional(v.array(v.any())),
    imageRef: v.optional(v.string()),
    builderMachineId: v.optional(v.string()),
    runtimeMachineId: v.optional(v.string()),
    error: v.optional(v.any()),
    updatedAt: v.string(),
    completedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deployment = await ctx.db
      .query("appDeployments")
      .withIndex("by_deployment", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("appId", args.appId)
          .eq("deploymentId", args.deploymentId),
      )
      .unique();
    if (!deployment) throw new Error("APP_DEPLOYMENT_NOT_FOUND");
    const {
      tenantId: _tenantId,
      appId: _appId,
      deploymentId: _deploymentId,
      ...patch
    } = args;
    await ctx.db.patch(deployment._id, patch);
    return deployment._id;
  },
});
