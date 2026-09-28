import {
  canPerformMemoryAction,
  createMemory,
  createMemoryRevision,
  type Memory,
  type MemoryAction,
  type MemoryActor,
  type MemoryPrincipal,
  type MemoryRevision,
  type MemoryScope,
} from "@kody-ade/memory";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import {
  memoryRevisionValidator,
  memoryActorValidator,
  memoryScopeValidator,
  memoryValidator,
} from "./memoryValidators";

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

function requireMemoryPermission(
  actor: Readonly<MemoryActor>,
  tenantId: string,
  scope: MemoryScope,
  action: MemoryAction,
): void {
  const principal: MemoryPrincipal = {
    actor,
    tenantIds: [tenantId],
  };
  if (!canPerformMemoryAction(principal, scope, action)) {
    throw new Error("Memory scope permission denied");
  }
}

function scopeFields(scope: MemoryScope): {
  scopeKind: MemoryScope["kind"];
  scopeId: string;
} {
  return scope.kind === "user"
    ? { scopeKind: scope.kind, scopeId: scope.userId }
    : { scopeKind: scope.kind, scopeId: scope.tenantId };
}

function scopeFromDoc(doc: Doc<"memories">): MemoryScope {
  return doc.scopeKind === "user"
    ? { kind: "user", userId: doc.scopeId }
    : { kind: "repository", tenantId: doc.scopeId };
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  if (left.kind === "user" && right.kind === "user") {
    return left.userId === right.userId;
  }
  if (left.kind === "repository" && right.kind === "repository") {
    return left.tenantId === right.tenantId;
  }
  return false;
}

function memoryFromDoc(doc: Doc<"memories">): Readonly<Memory> {
  return createMemory({
    id: doc.memoryId,
    scope: scopeFromDoc(doc),
    kind: doc.kind,
    content: {
      title: doc.title,
      summary: doc.summary,
      body: doc.body,
    },
    currentRevisionId: doc.currentRevisionId,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.expiresAt === undefined ? {} : { expiresAt: doc.expiresAt }),
  });
}

function revisionFromDoc(
  doc: Doc<"memoryRevisions">,
): Readonly<MemoryRevision> {
  return createMemoryRevision({
    id: doc.revisionId,
    memoryId: doc.memoryId,
    previousRevisionId: doc.previousRevisionId,
    kind: doc.kind,
    content: {
      title: doc.title,
      summary: doc.summary,
      body: doc.body,
    },
    evidence: doc.evidence,
    reason: doc.reason,
    actor: doc.actor,
    createdAt: doc.createdAt,
  });
}

function memoryDocument(memory: Readonly<Memory>) {
  return {
    memoryId: memory.id,
    ...scopeFields(memory.scope),
    kind: memory.kind,
    title: memory.content.title,
    summary: memory.content.summary,
    body: memory.content.body,
    searchText: [
      memory.content.title,
      memory.content.summary,
      memory.content.body,
    ].join("\n"),
    currentRevisionId: memory.currentRevisionId,
    status: memory.status,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
  };
}

function revisionDocument(revision: Readonly<MemoryRevision>) {
  return {
    revisionId: revision.id,
    memoryId: revision.memoryId,
    previousRevisionId: revision.previousRevisionId,
    kind: revision.kind,
    title: revision.content.title,
    summary: revision.content.summary,
    body: revision.content.body,
    evidence: [...revision.evidence],
    reason: revision.reason,
    actor: revision.actor,
    createdAt: revision.createdAt,
  };
}

async function findMemory(ctx: DatabaseContext, memoryId: string) {
  return await ctx.db
    .query("memories")
    .withIndex("by_memory", (index) => index.eq("memoryId", memoryId))
    .unique();
}

function validateCreatePair(
  memory: Readonly<Memory>,
  revision: Readonly<MemoryRevision>,
): void {
  if (
    revision.memoryId !== memory.id ||
    revision.id !== memory.currentRevisionId ||
    revision.previousRevisionId !== null ||
    revision.kind !== memory.kind ||
    revision.content.title !== memory.content.title ||
    revision.content.summary !== memory.content.summary ||
    revision.content.body !== memory.content.body
  ) {
    throw new Error("Initial memory and revision do not match");
  }
}

function sameContent(
  left: Memory["content"],
  right: MemoryRevision["content"],
): boolean {
  return (
    left.title === right.title &&
    left.summary === right.summary &&
    left.body === right.body
  );
}

function validateActor(
  actor: Readonly<MemoryActor>,
  revision: MemoryRevision,
): void {
  if (revision.actor.kind !== actor.kind || revision.actor.id !== actor.id) {
    throw new Error("Memory revision actor does not match caller context");
  }
}

const requestValidator = v.optional(
  v.object({ key: v.string(), hash: v.string() }),
);
type WriteRequest = { key: string; hash: string };
type WriteCaller = {
  actor: MemoryActor;
  tenantId: string;
  request?: WriteRequest;
};
async function replayRequest(ctx: MutationCtx, args: WriteCaller) {
  if (!args.request) return null;
  const receipt = await ctx.db
    .query("memoryWriteReceipts")
    .withIndex("by_request", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("actorKind", args.actor.kind)
        .eq("actorId", args.actor.id)
        .eq("key", args.request!.key),
    )
    .unique();
  if (!receipt) return null;
  if (receipt.expiresAt <= Date.now()) {
    await ctx.db.delete(receipt._id);
    return null;
  }
  if (receipt.hash !== args.request.hash)
    throw new ConvexError({
      code: "idempotency_conflict",
      message: "Memory idempotency conflict",
    });
  return receipt;
}
async function saveReceipt(
  ctx: MutationCtx,
  args: WriteCaller,
  memory: Memory,
) {
  if (!args.request) return;
  await ctx.db.insert("memoryWriteReceipts", {
    tenantId: args.tenantId,
    actorKind: args.actor.kind,
    actorId: args.actor.id,
    ...args.request,
    memoryId: memory.id,
    memory,
    deleted: false,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
}

export const create = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    memory: memoryValidator,
    revision: memoryRevisionValidator,
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    const memory = createMemory(args.memory);
    const revision = createMemoryRevision(args.revision);
    requireMemoryPermission(args.actor, args.tenantId, memory.scope, "write");
    validateActor(args.actor, revision);
    validateCreatePair(memory, revision);
    const replay = await replayRequest(ctx, args);
    if (replay) {
      if (replay.deleted || !replay.memory)
        throw new ConvexError({
          code: "memory_not_found",
          message: "Memory request result was deleted",
        });
      return replay.memory;
    }
    if (await findMemory(ctx, memory.id)) {
      throw new Error("Memory already exists");
    }
    const existingRevision = await ctx.db
      .query("memoryRevisions")
      .withIndex("by_revision", (index) => index.eq("revisionId", revision.id))
      .unique();
    if (existingRevision) throw new Error("Memory revision already exists");

    await ctx.db.insert("memoryRevisions", revisionDocument(revision));
    await ctx.db.insert("memories", memoryDocument(memory));
    await saveReceipt(ctx, args, memory);
    return args.request ? memory : memory.id;
  },
});

export const replay = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    request: v.object({ key: v.string(), hash: v.string() }),
  },
  handler: async (ctx, args) => {
    const receipt = await ctx.db
      .query("memoryWriteReceipts")
      .withIndex("by_request", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actorKind", args.actor.kind)
          .eq("actorId", args.actor.id)
          .eq("key", args.request.key),
      )
      .unique();
    if (!receipt || receipt.expiresAt <= Date.now()) return null;
    if (receipt.hash !== args.request.hash)
      throw new ConvexError({
        code: "idempotency_conflict",
        message: "Memory idempotency conflict",
      });
    if (receipt.deleted || !receipt.memory)
      throw new ConvexError({
        code: "memory_not_found",
        message: "Memory request result was deleted",
      });
    requireMemoryPermission(
      args.actor,
      args.tenantId,
      receipt.memory.scope,
      "read",
    );
    return receipt.memory;
  },
});

export const get = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    memoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await findMemory(ctx, args.memoryId);
    if (!doc) return null;
    const memory = memoryFromDoc(doc);
    try {
      requireMemoryPermission(args.actor, args.tenantId, memory.scope, "read");
      return memory;
    } catch {
      return null;
    }
  },
});

export const list = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    scope: memoryScopeValidator,
  },
  handler: async (ctx, args) => {
    requireMemoryPermission(args.actor, args.tenantId, args.scope, "read");
    const scope = scopeFields(args.scope);
    const docs = await ctx.db
      .query("memories")
      .withIndex("by_scope_status", (index) =>
        index
          .eq("scopeKind", scope.scopeKind)
          .eq("scopeId", scope.scopeId)
          .eq("status", "active"),
      )
      .order("desc")
      .take(100);
    return docs.map(memoryFromDoc);
  },
});

export const listPage = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    scope: memoryScopeValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    requireMemoryPermission(args.actor, args.tenantId, args.scope, "read");
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      throw new Error("Invalid page size");
    const scope = scopeFields(args.scope);
    const result = await ctx.db
      .query("memories")
      .withIndex("by_scope_status", (q) =>
        q
          .eq("scopeKind", scope.scopeKind)
          .eq("scopeId", scope.scopeId)
          .eq("status", "active"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > Date.now())
        .map(memoryFromDoc),
    };
  },
});

export const search = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    scope: memoryScopeValidator,
    searchText: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    requireMemoryPermission(args.actor, args.tenantId, args.scope, "read");
    const searchText = args.searchText.trim();
    if (!searchText) throw new Error("Memory search text is required");
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
      throw new Error("Memory search limit must be between 1 and 20");
    }
    const scope = scopeFields(args.scope);
    const query = ctx.db
      .query("memories")
      .withSearchIndex("search_memory", (search) =>
        search
          .search("searchText", searchText)
          .eq("scopeKind", scope.scopeKind)
          .eq("scopeId", scope.scopeId)
          .eq("status", "active"),
      );
    const results: Memory[] = [];
    for await (const doc of query) {
      if (doc.expiresAt && Date.parse(doc.expiresAt) <= Date.now()) continue;
      results.push(memoryFromDoc(doc));
      if (results.length === args.limit) break;
    }
    return results;
  },
});

export const listRevisions = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    memoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await findMemory(ctx, args.memoryId);
    if (!doc) return [];
    const memory = memoryFromDoc(doc);
    try {
      requireMemoryPermission(args.actor, args.tenantId, memory.scope, "read");
    } catch {
      return [];
    }
    const revisions = await ctx.db
      .query("memoryRevisions")
      .withIndex("by_memory", (index) => index.eq("memoryId", args.memoryId))
      .order("asc")
      .collect();
    return revisions.map(revisionFromDoc);
  },
});

export const revise = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    expectedRevisionId: v.string(),
    memory: memoryValidator,
    revision: memoryRevisionValidator,
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    const memory = createMemory(args.memory);
    const revision = createMemoryRevision(args.revision);
    requireMemoryPermission(args.actor, args.tenantId, memory.scope, "write");
    validateActor(args.actor, revision);
    const replay = await replayRequest(ctx, args);
    if (replay) {
      if (replay.deleted || !replay.memory)
        throw new ConvexError({
          code: "memory_not_found",
          message: "Memory request result was deleted",
        });
      return replay.memory;
    }
    const currentDoc = await findMemory(ctx, memory.id);
    if (!currentDoc) throw new Error("Memory not found");
    const current = memoryFromDoc(currentDoc);
    requireMemoryPermission(args.actor, args.tenantId, current.scope, "write");
    validateActor(args.actor, revision);
    if (current.status !== "active")
      throw new ConvexError({
        code: "invalid_memory_state",
        message: "Memory is not active",
      });
    if (current.currentRevisionId !== args.expectedRevisionId) {
      throw new ConvexError({
        code: "revision_conflict",
        message: "Memory changed since it was read",
      });
    }
    if (
      revision.memoryId !== current.id ||
      revision.previousRevisionId !== args.expectedRevisionId ||
      revision.id !== memory.currentRevisionId ||
      !sameScope(memory.scope, current.scope) ||
      memory.createdAt !== current.createdAt ||
      (memory.status !== "active" && memory.status !== "superseded") ||
      memory.updatedAt !== revision.createdAt ||
      memory.kind !== revision.kind ||
      !sameContent(memory.content, revision.content)
    ) {
      throw new Error("Revised memory does not match current memory");
    }
    const existingRevision = await ctx.db
      .query("memoryRevisions")
      .withIndex("by_revision", (index) => index.eq("revisionId", revision.id))
      .unique();
    if (existingRevision) throw new Error("Memory revision already exists");

    await ctx.db.insert("memoryRevisions", revisionDocument(revision));
    await ctx.db.replace(currentDoc._id, memoryDocument(memory));
    await saveReceipt(ctx, args, memory);
    return args.request ? memory : memory.id;
  },
});

export const remove = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    memoryId: v.string(),
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    const replay = await replayRequest(ctx, args);
    if (replay) return replay.deleted;
    const doc = await findMemory(ctx, args.memoryId);
    if (!doc) return false;
    const memory = memoryFromDoc(doc);
    requireMemoryPermission(args.actor, args.tenantId, memory.scope, "delete");
    const revisions = await ctx.db
      .query("memoryRevisions")
      .withIndex("by_memory", (index) => index.eq("memoryId", args.memoryId))
      .collect();
    for (const revision of revisions) {
      await ctx.db.delete(revision._id);
    }
    const receipts = await ctx.db
      .query("memoryWriteReceipts")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .collect();
    for (const receipt of receipts)
      await ctx.db.patch(receipt._id, { memory: undefined, deleted: true });
    if (args.request)
      await ctx.db.insert("memoryWriteReceipts", {
        tenantId: args.tenantId,
        actorKind: args.actor.kind,
        actorId: args.actor.id,
        ...args.request,
        memoryId: args.memoryId,
        deleted: true,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
    await ctx.db.delete(doc._id);
    return true;
  },
});
