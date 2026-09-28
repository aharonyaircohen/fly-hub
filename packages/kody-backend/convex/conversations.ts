import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import {
  agentIdentityValidator,
  conversationAttachmentValidator,
  conversationEntryValidator,
  conversationRuntimeValidator,
  conversationScopeValidator,
  machineAccessValidator,
} from "./conversationValidators";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

async function findConversation(
  ctx: DatabaseContext,
  tenantId: string,
  conversationId: string,
) {
  return await ctx.db
    .query("conversations")
    .withIndex("by_conversation", (q) =>
      q.eq("tenantId", tenantId).eq("conversationId", conversationId),
    )
    .unique();
}

async function requireConversation(
  ctx: DatabaseContext,
  tenantId: string,
  conversationId: string,
) {
  const conversation = await findConversation(ctx, tenantId, conversationId);
  if (!conversation) throw new Error("Conversation not found");
  return conversation;
}

export const create = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    surface: v.union(v.literal("global"), v.literal("vibe-default")),
    scope: conversationScopeValidator,
    title: v.string(),
    preview: v.optional(v.string()),
    pinned: v.boolean(),
    activeAgent: agentIdentityValidator,
    runtime: conversationRuntimeValidator,
    machineAccess: v.optional(machineAccessValidator),
    createdBy: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await findConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    if (existing) return existing._id;
    return await ctx.db.insert("conversations", args);
  },
});

export const updateRuntime = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    runtime: conversationRuntimeValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    await ctx.db.patch(conversation._id, {
      runtime: args.runtime,
      updatedAt: args.updatedAt,
    });
    return conversation._id;
  },
});

export const updateMachineAccess = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    machineAccess: machineAccessValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    await ctx.db.patch(conversation._id, {
      machineAccess: args.machineAccess,
      updatedAt: args.updatedAt,
    });
    return conversation._id;
  },
});

export const setInitialAgent = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    activeAgent: agentIdentityValidator,
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    const firstEntry = await ctx.db
      .query("conversationEntries")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId),
      )
      .first();
    if (firstEntry) {
      throw new Error("An established conversation requires an agent handoff");
    }
    await ctx.db.patch(conversation._id, {
      activeAgent: args.activeAgent,
      updatedAt: args.updatedAt,
    });
    return conversation._id;
  },
});

export const get = query({
  args: { tenantId: v.string(), conversationId: v.string() },
  handler: async (ctx, { tenantId, conversationId }) => {
    const conversation = await findConversation(ctx, tenantId, conversationId);
    if (!conversation) return null;

    const [entries, turns, checkpoints, runtimeBindings, attachments] =
      await Promise.all([
        ctx.db
          .query("conversationEntries")
          .withIndex("by_conversation", (q) =>
            q.eq("tenantId", tenantId).eq("conversationId", conversationId),
          )
          .collect(),
        ctx.db
          .query("conversationTurns")
          .withIndex("by_conversation", (q) =>
            q.eq("tenantId", tenantId).eq("conversationId", conversationId),
          )
          .collect(),
        ctx.db
          .query("conversationCheckpoints")
          .withIndex("by_conversation", (q) =>
            q.eq("tenantId", tenantId).eq("conversationId", conversationId),
          )
          .collect(),
        ctx.db
          .query("conversationRuntimeBindings")
          .withIndex("by_conversation_runtime", (q) =>
            q.eq("tenantId", tenantId).eq("conversationId", conversationId),
          )
          .collect(),
        ctx.db
          .query("conversationAttachments")
          .withIndex("by_conversation", (q) =>
            q.eq("tenantId", tenantId).eq("conversationId", conversationId),
          )
          .collect(),
      ]);

    return {
      conversation,
      entries,
      turns,
      checkpoints,
      runtimeBindings,
      attachments,
    };
  },
});

export const list = query({
  args: {
    tenantId: v.string(),
    surface: v.union(v.literal("global"), v.literal("vibe-default")),
  },
  handler: async (ctx, { tenantId, surface }) => {
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_updated", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .collect();
    return conversations.filter(
      (conversation) => (conversation.surface ?? "global") === surface,
    );
  },
});

export const appendEntry = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    entryId: v.string(),
    idempotencyKey: v.string(),
    entry: conversationEntryValidator,
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );

    const existing = await ctx.db
      .query("conversationEntries")
      .withIndex("by_idempotency", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) return existing._id;

    if (
      args.entry.kind === "message" &&
      args.entry.role === "assistant" &&
      (args.entry.author.kind !== "agent" ||
        args.entry.author.slug !== conversation.activeAgent.slug)
    ) {
      throw new Error("Assistant author must match the active agent");
    }
    if (
      args.entry.kind === "agent-handoff" &&
      args.entry.from.slug !== conversation.activeAgent.slug
    ) {
      throw new Error("Agent handoff source must match the active agent");
    }

    const last = await ctx.db
      .query("conversationEntries")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId),
      )
      .order("desc")
      .first();
    const entryId = await ctx.db.insert("conversationEntries", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      entryId: args.entryId,
      idempotencyKey: args.idempotencyKey,
      seq: (last?.seq ?? -1) + 1,
      entry: args.entry,
      updatedAt: args.entry.createdAt,
    });
    await ctx.db.patch(conversation._id, {
      updatedAt: args.entry.createdAt,
      ...(args.entry.kind === "agent-handoff"
        ? { activeAgent: args.entry.to }
        : {}),
    });
    return entryId;
  },
});

export const saveCheckpoint = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    version: v.number(),
    throughSeq: v.number(),
    agentEpochId: v.string(),
    summary: v.string(),
    sourceHash: v.string(),
    createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const existing = await ctx.db
      .query("conversationCheckpoints")
      .withIndex("by_conversation", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("version", args.version),
      )
      .unique();
    if (existing) {
      if (existing.sourceHash !== args.sourceHash) {
        throw new Error("Checkpoint version already exists");
      }
      return existing._id;
    }
    return await ctx.db.insert("conversationCheckpoints", args);
  },
});

export const bindRuntime = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    runtime: conversationRuntimeValidator,
    remoteConversationId: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const runtimeKind = args.runtime.kind;
    const existing = await ctx.db
      .query("conversationRuntimeBindings")
      .withIndex("by_conversation_runtime", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("runtimeKind", runtimeKind),
      )
      .unique();
    const binding = {
      runtime: args.runtime,
      remoteConversationId: args.remoteConversationId,
      updatedAt: args.updatedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, binding);
      return existing._id;
    }
    return await ctx.db.insert("conversationRuntimeBindings", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      runtimeKind,
      ...binding,
    });
  },
});

export const attachFile = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    attachment: conversationAttachmentValidator,
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const existing = await ctx.db
      .query("conversationAttachments")
      .withIndex("by_attachment", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("attachmentId", args.attachment.attachmentId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("conversationAttachments", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      attachmentId: args.attachment.attachmentId,
      attachment: args.attachment,
    });
  },
});

export const createAttachmentUpload = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const getAttachmentUrl = query({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    attachmentId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const attachment = await ctx.db
      .query("conversationAttachments")
      .withIndex("by_attachment", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("attachmentId", args.attachmentId),
      )
      .unique();
    if (!attachment) return null;
    return await ctx.storage.getUrl(
      attachment.attachment.storageId as Id<"_storage">,
    );
  },
});

export const removeAttachment = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    attachmentId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const attachment = await ctx.db
      .query("conversationAttachments")
      .withIndex("by_attachment", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("attachmentId", args.attachmentId),
      )
      .unique();
    if (!attachment) return null;
    await ctx.storage.delete(attachment.attachment.storageId as Id<"_storage">);
    await ctx.db.delete(attachment._id);
    return attachment._id;
  },
});

export const updateMessage = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    entryId: v.string(),
    content: v.string(),
    view: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("committed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const stored = await ctx.db
      .query("conversationEntries")
      .withIndex("by_entry", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("entryId", args.entryId),
      )
      .unique();
    if (!stored || stored.entry.kind !== "message") {
      throw new Error("Conversation message not found");
    }
    await ctx.db.patch(stored._id, {
      entry: {
        ...stored.entry,
        content: args.content,
        status: args.status,
        ...(args.view === undefined ? {} : { view: args.view }),
      },
      updatedAt: args.updatedAt,
    });
    return stored._id;
  },
});

export const removeMessage = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    entryId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireConversation(ctx, args.tenantId, args.conversationId);
    const stored = await ctx.db
      .query("conversationEntries")
      .withIndex("by_entry", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("conversationId", args.conversationId)
          .eq("entryId", args.entryId),
      )
      .unique();
    if (!stored) return null;
    await ctx.db.delete(stored._id);
    return stored._id;
  },
});

export const updateMetadata = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
    title: v.optional(v.string()),
    preview: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    await ctx.db.patch(conversation._id, {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.preview !== undefined ? { preview: args.preview } : {}),
      ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
      updatedAt: args.updatedAt,
    });
    return conversation._id;
  },
});

export const remove = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    const related = await Promise.all([
      ctx.db
        .query("conversationEntries")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationTurns")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationCheckpoints")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationRuntimeBindings")
        .withIndex("by_conversation_runtime", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationAttachments")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
    ]);
    for (const attachment of related[4]) {
      await ctx.storage.delete(
        attachment.attachment.storageId as Id<"_storage">,
      );
    }
    for (const document of related.flat()) await ctx.db.delete(document._id);
    await ctx.db.delete(conversation._id);
    return conversation._id;
  },
});

export const clear = mutation({
  args: {
    tenantId: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await requireConversation(
      ctx,
      args.tenantId,
      args.conversationId,
    );
    const [entries, checkpoints, attachments] = await Promise.all([
      ctx.db
        .query("conversationEntries")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationCheckpoints")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
      ctx.db
        .query("conversationAttachments")
        .withIndex("by_conversation", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("conversationId", args.conversationId),
        )
        .collect(),
    ]);
    for (const attachment of attachments) {
      await ctx.storage.delete(
        attachment.attachment.storageId as Id<"_storage">,
      );
    }
    for (const document of [...entries, ...checkpoints, ...attachments]) {
      await ctx.db.delete(document._id);
    }
    await ctx.db.patch(conversation._id, {
      preview: undefined,
      updatedAt: new Date().toISOString(),
    });
    return conversation._id;
  },
});
