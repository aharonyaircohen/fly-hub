import { v } from "convex/values";
import { query as publicQuery } from "./_generated/server";
import {
  companyIntentValidator,
  intentDecisionValidator,
} from "./validators";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

export const liveList = publicQuery({
  args: { tenantId: v.string(), serviceKey: v.optional(v.string()) },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("intents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .take(500),
});

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("intents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
});

export const get = query({
  args: { tenantId: v.string(), intentId: v.string() },
  handler: async (ctx, { tenantId, intentId }) =>
    await ctx.db
      .query("intents")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", tenantId).eq("intentId", intentId),
      )
      .unique(),
});

export const save = mutation({
  args: {
    tenantId: v.string(),
    intentId: v.string(),
    intent: companyIntentValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("intents")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("intentId", args.intentId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        intent: args.intent,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("intents", args);
  },
});

export const listDecisions = query({
  args: { tenantId: v.string(), intentId: v.string() },
  handler: async (ctx, { tenantId, intentId }) =>
    await ctx.db
      .query("intentDecisions")
      .withIndex("by_intent", (q) =>
        q.eq("tenantId", tenantId).eq("intentId", intentId),
      )
      .collect(),
});

export const appendDecision = mutation({
  args: {
    tenantId: v.string(),
    intentId: v.string(),
    decision: intentDecisionValidator,
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("intentDecisions")
        .withIndex("by_idempotency", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("intentId", args.intentId)
            .eq("idempotencyKey", args.idempotencyKey),
        )
        .unique();
      if (existing) return existing._id;
    }
    const last = await ctx.db
      .query("intentDecisions")
      .withIndex("by_intent", (q) =>
        q.eq("tenantId", args.tenantId).eq("intentId", args.intentId),
      )
      .order("desc")
      .first();
    return await ctx.db.insert("intentDecisions", {
      ...args,
      seq: (last?.seq ?? -1) + 1,
    });
  },
});
