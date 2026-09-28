import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";
import { memoryActorValidator } from "./memoryValidators";

const MEMORY_AUTOMATION_SUBJECTS = new Set([
  "learn-from-runs",
  "maintain-memory-quality",
]);
const MAX_LEASE_MS = 60 * 60 * 1000;
const MAX_RUN_SCAN = 100;

function requireEngine(actor: { kind: string; id: string }): void {
  if (actor.kind !== "engine" || !actor.id.trim()) {
    throw new Error("Memory learning requires an Engine actor");
  }
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a timestamp`);
  return parsed;
}

function validateLease(now: string, leaseUntil: string): void {
  const nowMs = timestamp(now, "Claim time");
  const leaseMs = timestamp(leaseUntil, "Claim lease");
  if (leaseMs <= nowMs || leaseMs - nowMs > MAX_LEASE_MS) {
    throw new Error("Memory learning lease window is invalid");
  }
}

function requireClaimOwner(
  claim: Doc<"memoryLearningRuns">,
  actor: { kind: string; id: string },
): void {
  if (claim.claimedBy !== actor.id) {
    throw new Error("Memory learning claim owner does not match");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSuccessfulRun(run: Doc<"agencyRuns">): boolean {
  const status = record(run.run)?.status;
  return (
    status === "success" || status === "succeeded" || status === "completed"
  );
}

function isMemoryAutomationRun(run: Doc<"agencyRuns">): boolean {
  if (MEMORY_AUTOMATION_SUBJECTS.has(run.subjectId)) return true;
  const parentRunId = record(run.run)?.parentRunId;
  return (
    typeof parentRunId === "string" &&
    [...MEMORY_AUTOMATION_SUBJECTS].some((subjectId) =>
      parentRunId.startsWith(`workflow:${subjectId}:`),
    )
  );
}

function learningSource(run: Doc<"agencyRuns">) {
  return {
    runId: run.runId,
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    run: run.run,
    updatedAt: run.updatedAt,
  };
}

export const claimNext = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    now: v.string(),
    leaseUntil: v.string(),
  },
  handler: async (ctx, args) => {
    requireEngine(args.actor);
    validateLease(args.now, args.leaseUntil);
    const nowMs = timestamp(args.now, "Claim time");
    const runs = await ctx.db
      .query("agencyRuns")
      .withIndex("by_tenant", (index) => index.eq("tenantId", args.tenantId))
      .order("desc")
      .take(MAX_RUN_SCAN);

    for (const run of runs) {
      if (!isSuccessfulRun(run) || isMemoryAutomationRun(run)) continue;
      const existing = await ctx.db
        .query("memoryLearningRuns")
        .withIndex("by_source", (index) =>
          index.eq("tenantId", args.tenantId).eq("sourceRunId", run.runId),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("memoryLearningRuns", {
          tenantId: args.tenantId,
          sourceRunId: run.runId,
          claimedBy: args.actor.id,
          status: "processing",
          claimedAt: args.now,
          leaseUntil: args.leaseUntil,
        });
        return learningSource(run);
      }
      if (
        existing.status !== "completed" &&
        timestamp(existing.leaseUntil, "Existing claim lease") <= nowMs
      ) {
        await ctx.db.patch(existing._id, {
          claimedBy: args.actor.id,
          status: "processing",
          claimedAt: args.now,
          leaseUntil: args.leaseUntil,
          completedAt: undefined,
          failure: undefined,
        });
        return learningSource(run);
      }
    }
    return null;
  },
});

export const complete = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    sourceRunId: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    requireEngine(args.actor);
    timestamp(args.now, "Completion time");
    const existing = await ctx.db
      .query("memoryLearningRuns")
      .withIndex("by_source", (index) =>
        index.eq("tenantId", args.tenantId).eq("sourceRunId", args.sourceRunId),
      )
      .unique();
    if (!existing) throw new Error("Memory learning claim was not found");
    requireClaimOwner(existing, args.actor);
    if (existing.status === "completed") return true;
    await ctx.db.patch(existing._id, {
      status: "completed",
      completedAt: args.now,
      leaseUntil: args.now,
      failure: undefined,
    });
    return true;
  },
});

export const fail = mutation({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    sourceRunId: v.string(),
    now: v.string(),
    failure: v.string(),
  },
  handler: async (ctx, args) => {
    requireEngine(args.actor);
    timestamp(args.now, "Failure time");
    const existing = await ctx.db
      .query("memoryLearningRuns")
      .withIndex("by_source", (index) =>
        index.eq("tenantId", args.tenantId).eq("sourceRunId", args.sourceRunId),
      )
      .unique();
    if (!existing) throw new Error("Memory learning claim was not found");
    requireClaimOwner(existing, args.actor);
    await ctx.db.patch(existing._id, {
      status: "failed",
      leaseUntil: args.now,
      failure: args.failure.trim().slice(0, 500),
    });
    return true;
  },
});

export const recentEvidence = query({
  args: {
    actor: memoryActorValidator,
    tenantId: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    requireEngine(args.actor);
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50) {
      throw new Error("Recent evidence limit must be between 1 and 50");
    }
    const runs = await ctx.db
      .query("agencyRuns")
      .withIndex("by_tenant", (index) => index.eq("tenantId", args.tenantId))
      .order("desc")
      .take(MAX_RUN_SCAN);
    return runs
      .filter((run) => isSuccessfulRun(run) && !isMemoryAutomationRun(run))
      .slice(0, args.limit)
      .map(learningSource);
  },
});
