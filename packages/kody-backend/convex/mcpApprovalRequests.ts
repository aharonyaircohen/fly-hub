import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const actorValidator = v.object({
  tokenId: v.string(),
  name: v.string(),
  actorLogin: v.string(),
  actorGithubId: v.number(),
});
const modeValidator = v.union(v.literal("start"), v.literal("resume"));
const terminalStatusValidator = v.union(
  v.literal("dispatched"),
  v.literal("failed"),
);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function approvalDetails(
  action: unknown,
  input: unknown,
): Record<string, string | boolean> | null {
  if (typeof action !== "string") return null;
  const value = object(input);
  if (!value) return null;
  if (action.endsWith(".delete") && typeof value.id === "string")
    return { id: value.id };
  if (action === "schedule.save") {
    const schedule = object(value.schedule);
    const target = object(schedule?.target);
    const trigger = object(schedule?.trigger);
    if (!schedule || typeof schedule.id !== "string") return null;
    const every =
      typeof schedule.every === "string"
        ? schedule.every
        : typeof trigger?.every === "string"
          ? trigger.every
          : null;
    return {
      id: schedule.id,
      ...(every ? { every } : {}),
      ...(typeof schedule.enabled === "boolean"
        ? { enabled: schedule.enabled }
        : {}),
      ...(typeof target?.kind === "string" ? { targetType: target.kind } : {}),
      ...(typeof target?.id === "string" ? { targetId: target.id } : {}),
    };
  }
  if (action === "trigger.save") {
    const trigger = object(value.trigger);
    const triggerAction = object(trigger?.action);
    if (!trigger || typeof trigger.id !== "string") return null;
    return {
      id: trigger.id,
      ...(typeof trigger.event === "string" ? { event: trigger.event } : {}),
      ...(typeof trigger.enabled === "boolean"
        ? { enabled: trigger.enabled }
        : {}),
      ...(typeof triggerAction?.type === "string"
        ? { actionType: triggerAction.type }
        : {}),
    };
  }
  if (action === "notification.rule.create") {
    const rule = object(value.rule);
    const channel = object(rule?.channel);
    if (!rule || typeof rule.name !== "string") return null;
    return {
      name: rule.name,
      ...(typeof rule.event === "string" ? { event: rule.event } : {}),
      ...(typeof rule.enabled === "boolean" ? { enabled: rule.enabled } : {}),
      ...(typeof channel?.type === "string"
        ? { channelType: channel.type }
        : {}),
    };
  }
  return null;
}

function publicRequest<T extends Record<string, unknown>>(row: T) {
  const {
    _id,
    _creationTime,
    approvalToken,
    idempotencyKey,
    requestHash,
    input: _input,
    ...safe
  } = row;
  const details = approvalDetails(row.action, _input);
  return { ...safe, ...(details ? { details } : {}) };
}

export const create = mutation({
  args: {
    tenantId: v.string(),
    requestId: v.string(),
    workRecordId: v.string(),
    targetKind: v.union(
      v.literal("workflow"),
      v.literal("capability"),
      v.literal("automation"),
    ),
    workflowId: v.string(),
    runId: v.string(),
    mode: modeValidator,
    input: v.any(),
    action: v.string(),
    approvalId: v.string(),
    approvalToken: v.string(),
    actor: actorValidator,
    idempotencyKey: v.string(),
    requestHash: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_idempotency", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("actor.tokenId", args.actor.tokenId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (existing.requestHash !== args.requestHash) {
        throw new Error(
          "Idempotency key was already used with different input",
        );
      }
      return publicRequest(existing);
    }
    const duplicate = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (duplicate) throw new Error("Approval request already exists");
    const id = await ctx.db.insert("mcpApprovalRequests", {
      ...args,
      status: "pending",
      updatedAt: args.createdAt,
    });
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Approval request was not stored");
    return publicRequest(row);
  },
});

export const listForWork = query({
  args: {
    tenantId: v.string(),
    workRecordId: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_work", (q) =>
        q.eq("tenantId", args.tenantId).eq("workRecordId", args.workRecordId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(100, Math.floor(args.limit))));
    return rows.map(publicRequest);
  },
});

export const list = query({
  args: {
    tenantId: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approving"),
        v.literal("rejected"),
        v.literal("dispatched"),
        v.literal("failed"),
        v.literal("expired"),
      ),
    ),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const rows = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(args.status ? 500 : limit);
    return rows
      .filter((row) => !args.status || row.status === args.status)
      .slice(0, limit)
      .map(publicRequest);
  },
});

export const getPublic = query({
  args: { tenantId: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    return row ? publicRequest(row) : null;
  },
});

export const claimDecision = mutation({
  args: {
    tenantId: v.string(),
    requestId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decidedBy: v.string(),
    decidedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (!row || row.status !== "pending") return null;
    if (Date.parse(row.expiresAt) <= Date.parse(args.decidedAt)) {
      await ctx.db.patch(row._id, {
        status: "expired",
        updatedAt: args.decidedAt,
      });
      return null;
    }
    if (args.decision === "rejected") {
      await ctx.db.patch(row._id, {
        status: "rejected",
        decidedBy: args.decidedBy,
        decidedAt: args.decidedAt,
        updatedAt: args.decidedAt,
      });
      return publicRequest({
        ...row,
        status: "rejected",
        decidedBy: args.decidedBy,
        decidedAt: args.decidedAt,
        updatedAt: args.decidedAt,
      });
    }
    await ctx.db.patch(row._id, {
      status: "approving",
      decidedBy: args.decidedBy,
      decidedAt: args.decidedAt,
      updatedAt: args.decidedAt,
    });
    return { ...row, status: "approving" as const };
  },
});

export const finish = mutation({
  args: {
    tenantId: v.string(),
    requestId: v.string(),
    status: terminalStatusValidator,
    result: v.any(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (!row || row.status !== "approving") return false;
    await ctx.db.patch(row._id, {
      status: args.status,
      result: args.result,
      updatedAt: args.updatedAt,
    });
    return true;
  },
});

export const recordExecution = mutation({
  args: {
    tenantId: v.string(),
    workflowId: v.string(),
    runId: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    summary: v.optional(v.string()),
    githubRunId: v.optional(v.string()),
    githubRunUrl: v.optional(v.string()),
    completedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) =>
        q.and(
          q.eq(q.field("targetKind"), "workflow"),
          q.eq(q.field("workflowId"), args.workflowId),
          q.eq(q.field("runId"), args.runId),
        ),
      )
      .take(2);
    if (matches.length === 0) return false;
    if (matches.length > 1)
      throw new Error("Multiple approval requests reference one workflow run");
    const row = matches[0];
    const previousResult =
      row.result && typeof row.result === "object" && !Array.isArray(row.result)
        ? (row.result as Record<string, unknown>)
        : {};
    const kind =
      typeof previousResult.execution === "string"
        ? previousResult.execution
        : "kody-engine";
    await ctx.db.patch(row._id, {
      result: {
        ...previousResult,
        execution: {
          kind,
          status: args.status,
          ...(args.summary ? { summary: args.summary } : {}),
          ...(args.githubRunId ? { githubRunId: args.githubRunId } : {}),
          ...(args.githubRunUrl ? { githubRunUrl: args.githubRunUrl } : {}),
          completedAt: args.completedAt,
        },
      },
      updatedAt: args.completedAt,
    });
    return true;
  },
});

export const remove = mutation({
  args: { tenantId: v.string(), requestId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpApprovalRequests")
      .withIndex("by_request", (q) =>
        q.eq("tenantId", args.tenantId).eq("requestId", args.requestId),
      )
      .unique();
    if (!row) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});
