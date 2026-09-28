import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const flowStateArgs = {
  tenantId: v.string(),
  actorId: v.string(),
  instanceId: v.string(),
  instanceKey: v.optional(v.string()),
  flowId: v.string(),
  flowVersion: v.number(),
  currentStepId: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("completed"),
    v.literal("cancelled"),
  ),
  revision: v.number(),
  data: v.any(),
  output: v.optional(v.any()),
  history: v.array(v.string()),
  stack: v.optional(
    v.array(
      v.object({
        flowId: v.string(),
        flowVersion: v.number(),
        currentStepId: v.string(),
        data: v.any(),
        history: v.array(v.string()),
      }),
    ),
  ),
  updatedAt: v.string(),
};

function activeKey(rootFlowId: string, instanceKey?: string): string {
  return JSON.stringify([rootFlowId, instanceKey ?? null]);
}

function rootFlowIdFor(row: {
  flowId: string;
  stack?: Array<{ flowId: string }>;
}): string {
  return row.stack?.[0]?.flowId ?? row.flowId;
}

export const get = query({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
  },
  handler: async (ctx, { tenantId, actorId, instanceId }) => {
    return await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_instance", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("actorId", actorId)
          .eq("instanceId", instanceId),
      )
      .unique();
  },
});

export const listActive = query({
  args: { tenantId: v.string(), actorId: v.string() },
  handler: async (ctx, { tenantId, actorId }) => {
    return await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_actor_status", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("actorId", actorId)
          .eq("status", "active"),
      )
      .order("desc")
      .collect();
  },
});

export const list = query({
  args: { tenantId: v.string(), actorId: v.string() },
  handler: async (ctx, { tenantId, actorId }) => {
    return await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_actor_status", (q) =>
        q.eq("tenantId", tenantId).eq("actorId", actorId),
      )
      .order("desc")
      .collect();
  },
});

export const upsert = mutation({
  args: flowStateArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_instance", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("instanceId", args.instanceId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        flowId: args.flowId,
        flowVersion: args.flowVersion,
        instanceKey: args.instanceKey,
        currentStepId: args.currentStepId,
        status: args.status,
        revision: args.revision,
        data: args.data,
        output: args.output ?? existing.output ?? {},
        history: args.history,
        stack: args.stack ?? existing.stack ?? [],
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("guidedFlowInstances", {
      ...args,
      rootFlowId: rootFlowIdFor(args),
      activeKey: activeKey(rootFlowIdFor(args), args.instanceKey),
      output: args.output ?? {},
      stack: args.stack ?? [],
    });
  },
});

export const startOrResume = mutation({
  args: {
    ...flowStateArgs,
    rootFlowId: v.string(),
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const key = activeKey(args.rootFlowId, args.instanceKey);
    const indexed = await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_active_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("activeKey", key)
          .eq("status", "active"),
      )
      .first();
    if (indexed && !args.restart) {
      return { created: false, instance: indexed };
    }
    if (indexed) {
      await ctx.db.patch(indexed._id, {
        status: "cancelled",
        updatedAt: args.updatedAt,
      });
    }

    // Adopt a pre-indexing active row instead of creating a duplicate.
    const legacyRows = await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_actor_status", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("status", "active"),
      )
      .collect();
    const matchingLegacy = legacyRows.filter(
      (row) =>
        row._id !== indexed?._id &&
        rootFlowIdFor(row) === args.rootFlowId &&
        (row.instanceKey ?? "") === (args.instanceKey ?? ""),
    );
    const legacy = matchingLegacy[0];
    if (legacy && !args.restart) {
      await ctx.db.patch(legacy._id, {
        rootFlowId: args.rootFlowId,
        activeKey: key,
      });
      return {
        created: false,
        instance: {
          ...legacy,
          rootFlowId: args.rootFlowId,
          activeKey: key,
        },
      };
    }

    if (args.restart) {
      await Promise.all(
        matchingLegacy.map((row) =>
          ctx.db.patch(row._id, {
            status: "cancelled",
            updatedAt: args.updatedAt,
          }),
        ),
      );
    }

    const { restart: _restart, ...instanceArgs } = args;
    const id = await ctx.db.insert("guidedFlowInstances", {
      ...instanceArgs,
      rootFlowId: args.rootFlowId,
      activeKey: key,
      output: args.output ?? {},
      stack: args.stack ?? [],
    });
    const instance = await ctx.db.get(id);
    if (!instance) throw new Error("GuidedFlow instance was not created");
    return { created: true, instance };
  },
});

export const update = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    instanceKey: v.optional(v.string()),
    expectedRevision: v.number(),
    flowId: v.optional(v.string()),
    flowVersion: v.optional(v.number()),
    currentStepId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    revision: v.number(),
    data: v.any(),
    output: v.optional(v.any()),
    history: v.array(v.string()),
    stack: v.optional(
      v.array(
        v.object({
          flowId: v.string(),
          flowVersion: v.number(),
          currentStepId: v.string(),
          data: v.any(),
          history: v.array(v.string()),
        }),
      ),
    ),
    updatedAt: v.string(),
    mutationId: v.string(),
    submission: v.optional(
      v.object({
        flowId: v.string(),
        flowVersion: v.number(),
        stepId: v.string(),
        actionId: v.string(),
        result: v.any(),
        submittedAt: v.string(),
      }),
    ),
    completions: v.optional(
      v.array(
        v.object({
          effectId: v.string(),
          flowId: v.string(),
          flowVersion: v.number(),
          action: v.optional(v.string()),
          completedAt: v.string(),
          data: v.any(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_instance", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("instanceId", args.instanceId),
      )
      .unique();

    if (!existing) throw new Error("GuidedFlow instance not found");
    if (existing.mutationId === args.mutationId) return existing._id;
    if (existing.revision !== args.expectedRevision) {
      throw new Error("GuidedFlow revision conflict");
    }
    if (args.revision !== args.expectedRevision + 1) {
      throw new Error("GuidedFlow revision must advance by one");
    }

    await ctx.db.patch(existing._id, {
      flowId: args.flowId ?? existing.flowId,
      flowVersion: args.flowVersion ?? existing.flowVersion,
      instanceKey: args.instanceKey ?? existing.instanceKey,
      currentStepId: args.currentStepId,
      status: args.status,
      revision: args.revision,
      data: args.data,
      output: args.output ?? existing.output ?? {},
      history: args.history,
      stack: args.stack ?? existing.stack ?? [],
      updatedAt: args.updatedAt,
      mutationId: args.mutationId,
    });
    if (args.submission) {
      await ctx.db.insert("guidedFlowSubmissions", {
        tenantId: args.tenantId,
        actorId: args.actorId,
        instanceId: args.instanceId,
        revision: args.revision,
        mutationId: args.mutationId,
        ...args.submission,
      });
    }
    for (const completion of args.completions ?? []) {
      const existingCompletion = await ctx.db
        .query("guidedFlowCompletions")
        .withIndex("by_completion", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("actorId", args.actorId)
            .eq("instanceId", args.instanceId),
        )
        .first();
      if (!existingCompletion) {
        await ctx.db.insert("guidedFlowCompletions", {
          tenantId: args.tenantId,
          actorId: args.actorId,
          instanceId: args.instanceId,
          flowId: completion.flowId,
          flowVersion: completion.flowVersion,
          completedAt: completion.completedAt,
          data: completion.data,
        });
      }
      const existingEffect = await ctx.db
        .query("guidedFlowEffects")
        .withIndex("by_effect", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("actorId", args.actorId)
            .eq("effectId", completion.effectId),
        )
        .unique();
      if (!existingEffect) {
        await ctx.db.insert("guidedFlowEffects", {
          tenantId: args.tenantId,
          actorId: args.actorId,
          instanceId: args.instanceId,
          effectId: completion.effectId,
          flowId: completion.flowId,
          flowVersion: completion.flowVersion,
          ...(completion.action ? { action: completion.action } : {}),
          data: completion.data,
          status: "pending",
          attempts: 0,
          createdAt: completion.completedAt,
          updatedAt: completion.completedAt,
        });
      }
    }
    return existing._id;
  },
});

export const listPendingEffects = query({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const forStatus = (status: "pending" | "failed") =>
      ctx.db
        .query("guidedFlowEffects")
        .withIndex("by_instance_status", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("actorId", args.actorId)
            .eq("instanceId", args.instanceId)
            .eq("status", status),
        )
        .collect();
    const [pending, failed] = await Promise.all([
      forStatus("pending"),
      forStatus("failed"),
    ]);
    return [...pending, ...failed];
  },
});

export const markEffect = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    effectId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    updatedAt: v.string(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const effect = await ctx.db
      .query("guidedFlowEffects")
      .withIndex("by_effect", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("effectId", args.effectId),
      )
      .unique();
    if (!effect) throw new Error("GuidedFlow effect not found");
    if (effect.status === "completed") return effect._id;
    await ctx.db.patch(effect._id, {
      status: args.status,
      updatedAt: args.updatedAt,
      ...(args.lastError ? { lastError: args.lastError.slice(0, 500) } : {}),
    });
    return effect._id;
  },
});

export const beginEffect = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    effectId: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const effect = await ctx.db
      .query("guidedFlowEffects")
      .withIndex("by_effect", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("effectId", args.effectId),
      )
      .unique();
    if (!effect) throw new Error("GuidedFlow effect not found");
    if (effect.status === "completed") return effect._id;
    await ctx.db.patch(effect._id, {
      attempts: effect.attempts + 1,
      updatedAt: args.updatedAt,
    });
    return effect._id;
  },
});

export const listSubmissions = query({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    beforeRevision: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { tenantId, actorId, instanceId, beforeRevision, limit },
  ) => {
    const query = ctx.db
      .query("guidedFlowSubmissions")
      .withIndex("by_instance_revision", (q) => {
        const instance = q
          .eq("tenantId", tenantId)
          .eq("actorId", actorId)
          .eq("instanceId", instanceId);
        return beforeRevision === undefined
          ? instance
          : instance.lt("revision", beforeRevision);
      })
      .order("desc");
    return await query.take(Math.min(Math.max(limit ?? 20, 1), 100));
  },
});

export const bindConversation = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    conversationId: v.string(),
    instanceId: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const instance = await ctx.db
      .query("guidedFlowInstances")
      .withIndex("by_instance", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("instanceId", args.instanceId),
      )
      .unique();
    if (!instance) throw new Error("GuidedFlow instance not found");

    const existing = await ctx.db
      .query("guidedFlowBindings")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("conversationId", args.conversationId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        instanceId: args.instanceId,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("guidedFlowBindings", args);
  },
});

export const getConversationBinding = query({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("guidedFlowBindings")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("conversationId", args.conversationId),
      )
      .unique(),
});

export const recordCompletion = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    instanceId: v.string(),
    flowId: v.string(),
    flowVersion: v.number(),
    completedAt: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("guidedFlowCompletions")
      .withIndex("by_completion", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorId", args.actorId)
          .eq("instanceId", args.instanceId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("guidedFlowCompletions", args);
  },
});

export const listCompletions = query({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, actorId, limit }) => {
    return await ctx.db
      .query("guidedFlowCompletions")
      .withIndex("by_actor", (q) =>
        q.eq("tenantId", tenantId).eq("actorId", actorId),
      )
      .order("desc")
      .take(Math.min(Math.max(limit ?? 100, 1), 500));
  },
});

/**
 * Publish a new version of a custom flow definition — the version bump and
 * existence checks happen inside one transaction, so concurrent editors
 * cannot lose each other's writes.
 */
export const saveDefinition = mutation({
  args: {
    tenantId: v.string(),
    flowId: v.string(),
    mode: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("archive"),
    ),
    definition: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("guidedFlowDefinitions")
      .withIndex("by_flow", (q) =>
        q.eq("tenantId", args.tenantId).eq("flowId", args.flowId),
      )
      .order("desc")
      .first();
    const available = latest !== null && latest.archived !== true;
    if (args.mode === "create" && available) {
      throw new Error("guided_flow_already_exists");
    }
    if (args.mode !== "create" && !available) {
      throw new Error("guided_flow_not_found");
    }
    const version = (latest?.version ?? 0) + 1;
    await ctx.db.insert("guidedFlowDefinitions", {
      tenantId: args.tenantId,
      flowId: args.flowId,
      version,
      ...(args.mode === "archive" ? { archived: true } : {}),
      definition: args.definition,
      updatedAt: args.updatedAt,
    });
    return version;
  },
});

/** Every repository-owned definition version (includes archived rows). */
export const listDefinitions = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    await ctx.db
      .query("guidedFlowDefinitions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
});
