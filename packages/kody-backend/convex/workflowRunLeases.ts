import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { serviceMutation } from "./lib/auth";

const leaseArgs = {
  tenantId: v.string(),
  workflowId: v.string(),
  runId: v.string(),
  ownerId: v.string(),
};

export const acquire = serviceMutation({
  args: { ...leaseArgs, nowMs: v.number(), leaseDurationMs: v.number() },
  handler: async (ctx, args) => {
    const existing = await findLease(ctx, args);
    if (
      existing &&
      existing.ownerId !== args.ownerId &&
      existing.expiresAtMs > args.nowMs
    ) {
      return {
        acquired: false as const,
        ownerId: existing.ownerId,
        expiresAtMs: existing.expiresAtMs,
      };
    }
    const expiresAtMs = args.nowMs + positiveDuration(args.leaseDurationMs);
    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerId: args.ownerId,
        expiresAtMs,
        updatedAtMs: args.nowMs,
      });
    } else {
      await ctx.db.insert("workflowRunLeases", {
        tenantId: args.tenantId,
        workflowId: args.workflowId,
        runId: args.runId,
        ownerId: args.ownerId,
        expiresAtMs,
        updatedAtMs: args.nowMs,
      });
    }
    return { acquired: true as const, ownerId: args.ownerId, expiresAtMs };
  },
});

export const renew = serviceMutation({
  args: { ...leaseArgs, nowMs: v.number(), leaseDurationMs: v.number() },
  handler: async (ctx, args) => {
    const existing = await findLease(ctx, args);
    if (
      !existing ||
      existing.ownerId !== args.ownerId ||
      existing.expiresAtMs <= args.nowMs
    )
      return false;
    await ctx.db.patch(existing._id, {
      expiresAtMs: args.nowMs + positiveDuration(args.leaseDurationMs),
      updatedAtMs: args.nowMs,
    });
    return true;
  },
});

export const release = serviceMutation({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const existing = await findLease(ctx, args);
    if (!existing || existing.ownerId !== args.ownerId) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});

function positiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("leaseDurationMs must be positive");
  return value;
}

async function findLease(
  ctx: MutationCtx,
  args: { tenantId: string; workflowId: string; runId: string },
) {
  return await ctx.db
    .query("workflowRunLeases")
    .withIndex("by_run", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("workflowId", args.workflowId)
        .eq("runId", args.runId),
    )
    .unique();
}
