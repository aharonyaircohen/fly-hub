import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const status = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("archived"),
);
const priority = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("normal"),
);
const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("passed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("userJourneys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .collect(),
});

export const get = query({
  args: { tenantId: v.string(), journeyId: v.string() },
  handler: async (ctx, { tenantId, journeyId }) => {
    const journey = await ctx.db
      .query("userJourneys")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", tenantId).eq("journeyId", journeyId),
      )
      .unique();
    if (!journey) return null;
    const versions = await ctx.db
      .query("userJourneyVersions")
      .withIndex("by_journey", (q) =>
        q.eq("tenantId", tenantId).eq("journeyId", journeyId),
      )
      .order("desc")
      .collect();
    return { journey, versions };
  },
});

export const save = mutation({
  args: {
    tenantId: v.string(),
    journeyId: v.string(),
    name: v.string(),
    goal: v.string(),
    status,
    priority,
    definition: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userJourneys")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", args.tenantId).eq("journeyId", args.journeyId),
      )
      .unique();
    const version = (existing?.currentVersion ?? 0) + 1;
    const journey = existing
      ? (await ctx.db.patch(existing._id, {
          name: args.name,
          goal: args.goal,
          status: args.status,
          priority: args.priority,
          currentVersion: version,
          updatedAt: args.updatedAt,
        }), existing._id)
      : await ctx.db.insert("userJourneys", {
          tenantId: args.tenantId,
          journeyId: args.journeyId,
          name: args.name,
          goal: args.goal,
          status: args.status,
          priority: args.priority,
          currentVersion: version,
          updatedAt: args.updatedAt,
        });
    await ctx.db.insert("userJourneyVersions", {
      tenantId: args.tenantId,
      journeyId: args.journeyId,
      version,
      definition: args.definition,
      createdAt: args.updatedAt,
    });
    return { journey, version };
  },
});

export const listRuns = query({
  args: { tenantId: v.string(), journeyId: v.string() },
  handler: async (ctx, { tenantId, journeyId }) =>
    await ctx.db
      .query("userJourneyRuns")
      .withIndex("by_journey", (q) =>
        q.eq("tenantId", tenantId).eq("journeyId", journeyId),
      )
      .order("desc")
      .collect(),
});

export const createRun = mutation({
  args: {
    tenantId: v.string(),
    journeyId: v.string(),
    runId: v.string(),
    version: v.number(),
    environment: v.string(),
    commitSha: v.optional(v.string()),
    runnerVersion: v.optional(v.string()),
    createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userJourneyRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", args.runId),
      )
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("userJourneyRuns", {
      ...args,
      status: "queued",
      updatedAt: args.createdAt,
    });
  },
});

export const updateRun = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    status: runStatus,
    updatedAt: v.string(),
    startedAt: v.optional(v.string()),
    finishedAt: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("userJourneyRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", args.runId),
      )
      .unique();
    if (!run) throw new Error("User Journey run not found");
    await ctx.db.patch(run._id, {
      status: args.status,
      updatedAt: args.updatedAt,
      ...(args.startedAt ? { startedAt: args.startedAt } : {}),
      ...(args.finishedAt ? { finishedAt: args.finishedAt } : {}),
      ...(args.error ? { error: args.error } : {}),
    });
    return run._id;
  },
});

export const appendRunEvent = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    event: v.any(),
    time: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("userJourneyRunEvents")
        .withIndex("by_idempotency", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("runId", args.runId)
            .eq("idempotencyKey", args.idempotencyKey),
        )
        .unique();
      if (existing) return existing._id;
    }
    const last = await ctx.db
      .query("userJourneyRunEvents")
      .withIndex("by_run", (q) => q.eq("tenantId", args.tenantId).eq("runId", args.runId))
      .order("desc")
      .first();
    return ctx.db.insert("userJourneyRunEvents", {
      ...args,
      seq: (last?.seq ?? -1) + 1,
    });
  },
});
