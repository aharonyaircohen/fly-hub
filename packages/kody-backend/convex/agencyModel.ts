import { v } from "convex/values";
import { agencyRunSubjectTypeValidator } from "./agencyValidators";
import { createRun } from "@kody-ade/agency-domain";

import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const scopeKind = v.union(
  v.literal("loop"),
  v.literal("pipeline"),
  v.literal("workflow"),
  v.literal("capability"),
);

const dispatchDecision = v.object({
  kind: v.union(v.literal("fire"), v.literal("skip")),
  reason: v.string(),
  scheduledAt: v.optional(v.string()),
  nextEligibleAt: v.optional(v.string()),
});

const MAX_DISPATCH_LEASE_MS = 15 * 60 * 1000;

function leaseWindow(now: string, leaseUntil: string) {
  const nowMs = Date.parse(now);
  const leaseUntilMs = Date.parse(leaseUntil);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(leaseUntilMs) ||
    leaseUntilMs <= nowMs ||
    leaseUntilMs - nowMs > MAX_DISPATCH_LEASE_MS
  ) {
    throw new Error("Agency Dispatch lease is invalid");
  }
  return { nowMs, leaseUntilMs };
}

function hasActiveBoundedLease(entry: { leaseUntil?: string }, nowMs: number) {
  if (!entry.leaseUntil) return false;
  const leaseUntilMs = Date.parse(entry.leaseUntil);
  return (
    Number.isFinite(leaseUntilMs) &&
    leaseUntilMs > nowMs &&
    leaseUntilMs - nowMs <= MAX_DISPATCH_LEASE_MS
  );
}

export const reserveDispatch = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    idempotencyKey: v.string(),
    loopId: v.string(),
    decision: dispatchDecision,
    leaseUntil: v.string(),
    reservationId: v.string(),
    correlationId: v.string(),
    policyHash: v.string(),
    effectivePolicy: v.any(),
    definitionRefs: v.array(v.any()),
    maxConcurrentRuns: v.number(),
    requiresApproval: v.boolean(),
    approvalScopeKind: scopeKind,
    approvalScopeId: v.string(),
    approvalAction: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const { nowMs } = leaseWindow(args.now, args.leaseUntil);
    if (
      !Number.isInteger(args.maxConcurrentRuns) ||
      args.maxConcurrentRuns < 1
    ) {
      throw new Error("Agency Dispatch concurrency limit is invalid");
    }
    const existing = await ctx.db
      .query("agencyDispatches")
      .withIndex("by_tenant_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    const reclaimable =
      existing?.status === "reserved" &&
      !hasActiveBoundedLease(existing, nowMs);
    const retryable =
      existing?.status === "waiting-approval" ||
      existing?.status === "waiting-capacity";
    if (existing && !reclaimable && !retryable) {
      return {
        acquired: false,
        dispatchId: existing._id,
        reason: "duplicate" as const,
      };
    }

    const active = await ctx.db
      .query("agencyDispatches")
      .withIndex("by_policy_status", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("policyHash", args.policyHash)
          .eq("status", "reserved"),
      )
      .collect();
    const activeCount = active.filter((entry) =>
      hasActiveBoundedLease(entry, nowMs),
    ).length;
    if (activeCount >= args.maxConcurrentRuns) {
      const waiting = {
        tenantId: args.tenantId,
        idempotencyKey: args.idempotencyKey,
        loopId: args.loopId,
        decision: args.decision,
        status: "waiting-capacity" as const,
        correlationId: args.correlationId,
        policyHash: args.policyHash,
        effectivePolicy: args.effectivePolicy,
        definitionRefs: args.definitionRefs,
        updatedAt: args.now,
      };
      if (existing) await ctx.db.patch(existing._id, waiting);
      else
        await ctx.db.insert("agencyDispatches", {
          ...waiting,
          createdAt: args.now,
        });
      return {
        acquired: false,
        dispatchId: existing?._id,
        reason: "concurrency-limit" as const,
      };
    }

    let approvalId: string | undefined;
    if (args.requiresApproval) {
      const approvals = await ctx.db
        .query("agencyApprovals")
        .withIndex("by_scope", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("scopeKind", args.approvalScopeKind)
            .eq("scopeId", args.approvalScopeId)
            .eq("status", "available"),
        )
        .collect();
      const approval = approvals
        .filter(
          (entry) =>
            (entry.action === "*" || entry.action === args.approvalAction) &&
            (entry.expiresAt === undefined ||
              Date.parse(entry.expiresAt) > Date.parse(args.now)),
        )
        .sort((left, right) =>
          left.approvedAt.localeCompare(right.approvedAt),
        )[0];
      if (!approval) {
        const waiting = {
          tenantId: args.tenantId,
          idempotencyKey: args.idempotencyKey,
          loopId: args.loopId,
          decision: args.decision,
          status: "waiting-approval" as const,
          correlationId: args.correlationId,
          policyHash: args.policyHash,
          effectivePolicy: args.effectivePolicy,
          definitionRefs: args.definitionRefs,
          updatedAt: args.now,
        };
        if (existing) await ctx.db.patch(existing._id, waiting);
        else
          await ctx.db.insert("agencyDispatches", {
            ...waiting,
            createdAt: args.now,
          });
        return {
          acquired: false,
          dispatchId: existing?._id,
          reason: "approval-required" as const,
        };
      }
      approvalId = approval.approvalId;
      await ctx.db.patch(approval._id, {
        status: "consumed",
        consumedAt: args.now,
        dispatchKey: args.idempotencyKey,
      });
    }

    const reservation = {
      tenantId: args.tenantId,
      idempotencyKey: args.idempotencyKey,
      loopId: args.loopId,
      decision: args.decision,
      status: "reserved" as const,
      leaseUntil: args.leaseUntil,
      reservationId: args.reservationId,
      correlationId: args.correlationId,
      policyHash: args.policyHash,
      effectivePolicy: args.effectivePolicy,
      definitionRefs: args.definitionRefs,
      ...(approvalId ? { approvalId } : {}),
      updatedAt: args.now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, reservation);
      return { acquired: true, dispatchId: existing._id };
    }
    const dispatchId = await ctx.db.insert("agencyDispatches", {
      ...reservation,
      createdAt: args.now,
    });
    return { acquired: true, dispatchId };
  },
});

export const renewDispatch = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    idempotencyKey: v.string(),
    reservationId: v.string(),
    leaseUntil: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    leaseWindow(args.now, args.leaseUntil);
    const existing = await ctx.db
      .query("agencyDispatches")
      .withIndex("by_tenant_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!existing || existing.status !== "reserved") {
      throw new Error("Agency Dispatch reservation is not active");
    }
    if (existing.reservationId !== args.reservationId) {
      throw new Error("Agency Dispatch reservation is stale");
    }
    await ctx.db.patch(existing._id, {
      leaseUntil: args.leaseUntil,
      updatedAt: args.now,
    });
  },
});

export const recordSkippedDispatch = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    idempotencyKey: v.string(),
    loopId: v.string(),
    decision: dispatchDecision,
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agencyDispatches")
      .withIndex("by_tenant_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("agencyDispatches", {
      tenantId: args.tenantId,
      idempotencyKey: args.idempotencyKey,
      loopId: args.loopId,
      decision: args.decision,
      status: "skipped",
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const finishDispatch = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    idempotencyKey: v.string(),
    reservationId: v.string(),
    status: v.union(
      v.literal("dispatched"),
      v.literal("failed"),
      v.literal("dead-letter"),
    ),
    runId: v.optional(v.string()),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agencyDispatches")
      .withIndex("by_tenant_key", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!existing) throw new Error("Agency Dispatch reservation not found");
    if (existing.status !== "reserved")
      throw new Error("Agency Dispatch is already terminal");
    if (existing.reservationId !== args.reservationId) {
      throw new Error("Agency Dispatch reservation is stale");
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      ...(args.runId ? { runId: args.runId } : {}),
      updatedAt: args.now,
    });
  },
});

export const grantApproval = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    approvalId: v.string(),
    scopeKind,
    scopeId: v.string(),
    action: v.string(),
    approvedBy: v.string(),
    approvedAt: v.string(),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agencyApprovals")
      .withIndex("by_approval_id", (q) =>
        q.eq("tenantId", args.tenantId).eq("approvalId", args.approvalId),
      )
      .unique();
    if (existing) throw new Error("Agency Approval already exists");
    const { serviceKey: _serviceKey, ...approval } = args;
    return ctx.db.insert("agencyApprovals", {
      ...approval,
      status: "available",
    });
  },
});

export const consumeApproval = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    approvalId: v.string(),
    scopeKind,
    scopeId: v.string(),
    action: v.string(),
    approvedBy: v.string(),
    dispatchKey: v.string(),
    consumedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db
      .query("agencyApprovals")
      .withIndex("by_approval_id", (q) =>
        q.eq("tenantId", args.tenantId).eq("approvalId", args.approvalId),
      )
      .unique();
    if (
      !approval ||
      approval.status !== "available" ||
      approval.scopeKind !== args.scopeKind ||
      approval.scopeId !== args.scopeId ||
      approval.action !== args.action ||
      approval.approvedBy !== args.approvedBy ||
      (approval.expiresAt !== undefined &&
        Date.parse(approval.expiresAt) <= Date.parse(args.consumedAt))
    ) {
      return false;
    }
    await ctx.db.patch(approval._id, {
      status: "consumed",
      consumedAt: args.consumedAt,
      dispatchKey: args.dispatchKey,
    });
    return true;
  },
});

export const listApprovals = query({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    scopeKind: v.optional(scopeKind),
    scopeId: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    if (args.scopeKind && args.scopeId) {
      return ctx.db
        .query("agencyApprovals")
        .withIndex("by_scope", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("scopeKind", args.scopeKind!)
            .eq("scopeId", args.scopeId!),
        )
        .order("desc")
        .take(limit);
    }
    return ctx.db
      .query("agencyApprovals")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);
  },
});

export const revokeApproval = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    approvalId: v.string(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db
      .query("agencyApprovals")
      .withIndex("by_approval_id", (q) =>
        q.eq("tenantId", args.tenantId).eq("approvalId", args.approvalId),
      )
      .unique();
    if (!approval) throw new Error("Agency Approval not found");
    if (approval.status !== "available") {
      throw new Error("Only an available Agency Approval can be revoked");
    }
    await ctx.db.patch(approval._id, { status: "revoked" });
  },
});

export const createRunRecord = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    subjectType: agencyRunSubjectTypeValidator,
    subjectId: v.string(),
    run: v.any(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = createRun(args.run);
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Agency Run must start active");
    }
    const existing = await ctx.db
      .query("agencyRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", run.id),
      )
      .unique();
    if (existing) throw new Error("Agency Run already exists");
    return ctx.db.insert("agencyRuns", {
      tenantId: args.tenantId,
      runId: run.id,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      run,
      updatedAt: args.now,
    });
  },
});

export const finishRunRecord = mutation({
  args: {
    serviceKey: v.optional(v.string()),
    tenantId: v.string(),
    run: v.any(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = createRun(args.run);
    if (!["succeeded", "failed", "cancelled"].includes(run.status)) {
      throw new Error("Agency Run must finish terminal");
    }
    const existing = await ctx.db
      .query("agencyRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", run.id),
      )
      .unique();
    if (!existing) throw new Error("Agency Run not found");
    const previous = createRun(existing.run);
    if (!["queued", "running"].includes(previous.status)) {
      throw new Error("Agency Run is already terminal");
    }
    if (
      previous.id !== run.id ||
      previous.startedAt !== run.startedAt ||
      previous.agent !== run.agent ||
      JSON.stringify(previous.target) !== JSON.stringify(run.target) ||
      previous.todoId !== run.todoId ||
      previous.parentRunId !== run.parentRunId
    ) {
      throw new Error("Agency Run immutable context changed");
    }
    await ctx.db.patch(existing._id, { run, updatedAt: args.now });
  },
});
