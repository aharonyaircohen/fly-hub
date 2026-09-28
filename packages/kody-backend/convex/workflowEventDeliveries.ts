import { v } from "convex/values";
import { serviceMutation, serviceQuery } from "./lib/auth";

export const reserve = serviceMutation({
  args: {
    tenantId: v.string(),
    deliveryId: v.string(),
    triggerId: v.string(),
    workflowId: v.string(),
    eventName: v.string(),
    requestId: v.string(),
    sourceEventId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    input: v.any(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existingBySource = args.sourceEventId
      ? await ctx.db
          .query("workflowEventDeliveries")
          .withIndex("by_source_key", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("sourceEventId", args.sourceEventId)
              .eq("triggerId", args.triggerId),
          )
          .unique()
      : null;
    const existing =
      existingBySource ??
      (await ctx.db
        .query("workflowEventDeliveries")
        .withIndex("by_key", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("deliveryId", args.deliveryId)
            .eq("triggerId", args.triggerId),
        )
        .unique());

    if (!existing) {
      await ctx.db.insert("workflowEventDeliveries", {
        tenantId: args.tenantId,
        deliveryId: args.deliveryId,
        triggerId: args.triggerId,
        workflowId: args.workflowId,
        eventName: args.eventName,
        requestId: args.requestId,
        sourceEventId: args.sourceEventId,
        sourceUrl: args.sourceUrl,
        input: args.input,
        status: "pending",
        attempts: 1,
        createdAt: args.now,
        updatedAt: args.now,
      });
      return { claimed: true, status: "pending" as const };
    }

    const stalePending =
      existing.status === "pending" &&
      Date.parse(args.now) - Date.parse(existing.updatedAt) > 5 * 60 * 1000;
    if (existing.status === "failed" || stalePending) {
      await ctx.db.patch(existing._id, {
        status: "pending",
        attempts: existing.attempts + 1,
        error: undefined,
        updatedAt: args.now,
      });
      return { claimed: true, status: "pending" as const };
    }

    return { claimed: false, status: existing.status };
  },
});

export const recent = serviceQuery({
  args: {
    tenantId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, limit }) => {
    const rows = await ctx.db
      .query("workflowEventDeliveries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 20, 1), 100));

    return rows.map((row) => ({
      deliveryId: row.deliveryId,
      triggerId: row.triggerId,
      workflowId: row.workflowId,
      eventName: row.eventName,
      requestId: row.requestId,
      sourceEventId: row.sourceEventId,
      sourceUrl: row.sourceUrl,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const markDispatched = serviceMutation({
  args: {
    tenantId: v.string(),
    deliveryId: v.string(),
    triggerId: v.string(),
    sourceEventId: v.optional(v.string()),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existingBySource = args.sourceEventId
      ? await ctx.db
          .query("workflowEventDeliveries")
          .withIndex("by_source_key", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("sourceEventId", args.sourceEventId)
              .eq("triggerId", args.triggerId),
          )
          .unique()
      : null;
    const existing =
      existingBySource ??
      (await ctx.db
        .query("workflowEventDeliveries")
        .withIndex("by_key", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("deliveryId", args.deliveryId)
            .eq("triggerId", args.triggerId),
        )
        .unique());
    if (!existing) return false;
    await ctx.db.patch(existing._id, {
      status: "dispatched",
      error: undefined,
      updatedAt: args.now,
    });
    return true;
  },
});

export const markFailed = serviceMutation({
  args: {
    tenantId: v.string(),
    deliveryId: v.string(),
    triggerId: v.string(),
    sourceEventId: v.optional(v.string()),
    error: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existingBySource = args.sourceEventId
      ? await ctx.db
          .query("workflowEventDeliveries")
          .withIndex("by_source_key", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("sourceEventId", args.sourceEventId)
              .eq("triggerId", args.triggerId),
          )
          .unique()
      : null;
    const existing =
      existingBySource ??
      (await ctx.db
        .query("workflowEventDeliveries")
        .withIndex("by_key", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("deliveryId", args.deliveryId)
            .eq("triggerId", args.triggerId),
        )
        .unique());
    if (!existing) return false;
    await ctx.db.patch(existing._id, {
      status: "failed",
      error: args.error.slice(0, 2000),
      updatedAt: args.now,
    });
    return true;
  },
});
