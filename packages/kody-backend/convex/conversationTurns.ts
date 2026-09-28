import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import {
  agentIdentityValidator,
  conversationTurnProgressValidator,
  conversationTurnRecoveryValidator,
} from "./conversationValidators";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

async function requireConversation(
  ctx: DatabaseContext,
  tenantId: string,
  conversationId: string,
) {
  const conversation = await ctx.db
    .query("conversations")
    .withIndex("by_conversation", (q) =>
      q.eq("tenantId", tenantId).eq("conversationId", conversationId),
    )
    .unique();
  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

async function findTurn(
  ctx: DatabaseContext,
  tenantId: string,
  conversationId: string,
  turnId: string,
) {
  return await ctx.db
    .query("conversationTurns")
    .withIndex("by_turn", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("conversationId", conversationId)
        .eq("turnId", turnId),
    )
    .unique();
}

export const start = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    backend: v.union(
      v.literal("direct"),
      v.literal("brain"),
      v.literal("engine"),
      v.literal("live"),
    ),
    agent: agentIdentityValidator,
    startedAt: v.string(),
    createIfMissing: v.optional(
      v.object({
        owner: v.optional(v.string()),
        repo: v.optional(v.string()),
        modelId: v.string(),
        createdBy: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let conversation = await ctx.db
      .query("conversations")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId),
      )
      .unique();
    if (!conversation && args.createIfMissing) {
      const repositoryScope =
        args.createIfMissing.owner && args.createIfMissing.repo
          ? {
              kind: "repository" as const,
              owner: args.createIfMissing.owner,
              repo: args.createIfMissing.repo,
            }
          : { kind: "global" as const };
      const conversationDocument = {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        surface: "global" as const,
        scope: repositoryScope,
        title: "New conversation",
        pinned: false,
        activeAgent: args.agent,
        runtime: {
          kind: "direct" as const,
          modelId: args.createIfMissing.modelId,
        },
        createdBy: args.createIfMissing.createdBy,
        createdAt: args.startedAt,
        updatedAt: args.startedAt,
      };
      await ctx.db.insert("conversations", conversationDocument);
      conversation = await ctx.db
        .query("conversations")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .unique();
    }
    if (!conversation) throw new Error("Conversation not found");
    const existing = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (existing) return existing._id;
    if (conversation.activeAgent.slug !== args.agent.slug) {
      throw new Error("Turn agent must match the active agent");
    }
    return await ctx.db.insert("conversationTurns", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      backend: args.backend,
      agent: args.agent,
      startedAt: args.startedAt,
      status: "running",
      updatedAt: args.startedAt,
    });
  },
});

export const complete = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    content: v.string(),
    completedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    const turn = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (!turn) throw new Error("Conversation turn not found");
    if (turn.status === "completed") return turn._id;
    if (conversation.activeAgent.slug !== turn.agent.slug) {
      throw new Error("Turn agent must match the active agent");
    }

    const assistantEntryId = `assistant:${args.turnId}`;
    const existingEntry = await ctx.db
      .query("conversationEntries")
      .withIndex("by_entry", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("entryId", assistantEntryId),
      )
      .unique();
    if (!existingEntry) {
      const last = await ctx.db
        .query("conversationEntries")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .order("desc")
        .first();
      await ctx.db.insert("conversationEntries", {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        entryId: assistantEntryId,
        idempotencyKey: assistantEntryId,
        seq: (last?.seq ?? -1) + 1,
        entry: {
          kind: "message",
          role: "assistant",
          author: {
            kind: "agent",
            slug: turn.agent.slug,
            title: turn.agent.title,
          },
          content: args.content,
          status: "committed",
          turnId: args.turnId,
          createdAt: args.completedAt,
        },
        updatedAt: args.completedAt,
      });
    } else if (existingEntry.entry.kind === "message") {
      await ctx.db.patch(existingEntry._id, {
        entry: {
          ...existingEntry.entry,
          content: args.content,
          status: "committed",
          turnId: args.turnId,
        },
        updatedAt: args.completedAt,
      });
    }
    await ctx.db.patch(turn._id, {
      status: "completed",
      assistantEntryId,
      recovery: undefined,
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
    });
    await ctx.db.patch(conversation._id, { updatedAt: args.completedAt });
    return turn._id;
  },
});

export const updateProgress = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    progress: conversationTurnProgressValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const turn = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (!turn) throw new Error("Conversation turn not found");
    if (turn.status !== "running") return turn._id;
    await ctx.db.patch(turn._id, {
      progress: args.progress,
      updatedAt: args.updatedAt,
    });
    return turn._id;
  },
});

export const saveRecovery = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    recovery: conversationTurnRecoveryValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const turn = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (!turn) throw new Error("Conversation turn not found");
    if (turn.status === "completed") return turn._id;
    await ctx.db.patch(turn._id, {
      recovery: args.recovery,
      updatedAt: args.updatedAt,
    });
    return turn._id;
  },
});

export const clearRecovery = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const turn = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (!turn) throw new Error("Conversation turn not found");
    await ctx.db.patch(turn._id, {
      recovery: undefined,
      updatedAt: args.updatedAt,
    });
    return turn._id;
  },
});

export const fail = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    errorCode: v.string(),
    errorDetail: v.optional(v.string()),
    failedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const turn = await findTurn(
      ctx,
      args.tenantId,
      args.conversationId,
      args.turnId,
    );
    if (!turn) throw new Error("Conversation turn not found");
    if (turn.status === "completed") return turn._id;
    await ctx.db.patch(turn._id, {
      status: "failed",
      errorCode: args.errorCode,
      errorDetail: args.errorDetail?.slice(0, 500),
      completedAt: args.failedAt,
      updatedAt: args.failedAt,
    });
    return turn._id;
  },
});

export const get = query({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
  },
  handler: async (ctx, args) =>
    await findTurn(ctx, args.tenantId, args.conversationId, args.turnId),
});
