import { v } from "convex/values";
import { nextLoopRunAt, type Trigger } from "@kody-ade/agency-domain";

import { dispatchLoopWakeToDashboard } from "../src/loop-wake-dispatch";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { serviceMutation as mutation } from "./lib/auth";
import { taskKindForLoop, taskLoopRegistration } from "./agencyRequestLoops";

const DISPATCH_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;

type WakeClaim = {
  tenantId: string;
  wakeId: string;
  loopId: string;
  scheduledFor: string;
};
type WakeDispatchSummary = {
  mode: "shadow" | "dispatch";
  claimed: number;
  dispatched: number;
};

export async function syncLoopRegistration(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    loopId: string;
    enabled: boolean;
    trigger?: Trigger;
    updatedAt: string;
  },
) {
  if (!REPOSITORY.test(args.tenantId)) {
    throw new Error("Loop wake tenant must be owner/repository");
  }
  if (!args.loopId.trim()) throw new Error("Loop wake id is required");
  const existing = await ctx.db
    .query("loopWakeRegistrations")
    .withIndex("by_loop", (q) =>
      q.eq("tenantId", args.tenantId).eq("loopId", args.loopId),
    )
    .unique();
  if (args.enabled) {
    if (!args.trigger || args.trigger.type !== "schedule") {
      throw new Error("Scheduled Loop trigger is required");
    }
    const storedTrigger = existing?.trigger as
      Extract<Trigger, { type: "schedule" }> | undefined;
    const unchanged =
      storedTrigger?.type === "schedule" &&
      storedTrigger.every === args.trigger.every &&
      storedTrigger.at?.time === args.trigger.at?.time &&
      storedTrigger.at?.timezone === args.trigger.at?.timezone;
    const nextDueAt =
      unchanged && existing?.nextDueAt
        ? existing.nextDueAt
        : nextLoopRunAt(args.trigger, new Date(args.updatedAt));
    if (existing) {
      await ctx.db.patch(existing._id, {
        trigger: args.trigger,
        nextDueAt,
        updatedAt: args.updatedAt,
      });
      return { registered: true };
    }
    await ctx.db.insert("loopWakeRegistrations", {
      tenantId: args.tenantId,
      loopId: args.loopId,
      trigger: args.trigger,
      nextDueAt,
      updatedAt: args.updatedAt,
    });
    return { registered: true };
  }

  if (!existing) {
    return { registered: false };
  }
  await ctx.db.delete(existing._id);
  return { registered: false };
}

export const syncRegistration = mutation({
  args: {
    tenantId: v.string(),
    loopId: v.string(),
    enabled: v.boolean(),
    trigger: v.optional(v.any()),
    updatedAt: v.string(),
  },
  handler: syncLoopRegistration,
});

async function syncOwnedTaskRegistration(
  ctx: MutationCtx,
  tenantId: string,
  loopId: string,
  updatedAt: string,
): Promise<boolean> {
  const kind = taskKindForLoop(loopId);
  if (!kind) return false;
  const task = await ctx.db
    .query("repoDocs")
    .withIndex("by_kind", (q) => q.eq("tenantId", tenantId).eq("kind", kind))
    .unique();
  if (!task) return false;
  const registration = taskLoopRegistration(kind, task.doc)!;
  await syncLoopRegistration(ctx, { tenantId, ...registration, updatedAt });
  return true;
}

export const replaceRegistrations = mutation({
  args: {
    tenantId: v.string(),
    loops: v.array(v.any()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const desired = new Map(
      args.loops
        .filter(
          (loop) =>
            loop &&
            typeof loop === "object" &&
            loop.enabled === true &&
            loop.trigger?.type === "schedule",
        )
        .map((loop) => [String(loop.id).trim(), loop.trigger as Trigger]),
    );
    const existing = await ctx.db
      .query("loopWakeRegistrations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    for (const registration of existing) {
      if (
        await syncOwnedTaskRegistration(
          ctx,
          args.tenantId,
          registration.loopId,
          args.updatedAt,
        )
      ) {
        desired.delete(registration.loopId);
        continue;
      }
      const trigger = desired.get(registration.loopId);
      if (trigger) {
        desired.delete(registration.loopId);
        await syncLoopRegistration(ctx, {
          tenantId: args.tenantId,
          loopId: registration.loopId,
          enabled: true,
          trigger,
          updatedAt: args.updatedAt,
        });
      } else {
        await syncLoopRegistration(ctx, {
          tenantId: args.tenantId,
          loopId: registration.loopId,
          enabled: false,
          updatedAt: args.updatedAt,
        });
      }
    }
    for (const [loopId, trigger] of desired) {
      if (
        await syncOwnedTaskRegistration(
          ctx,
          args.tenantId,
          loopId,
          args.updatedAt,
        )
      )
        continue;
      await syncLoopRegistration(ctx, {
        tenantId: args.tenantId,
        loopId,
        enabled: true,
        trigger,
        updatedAt: args.updatedAt,
      });
    }
    return { count: args.loops.length };
  },
});

export const claimDue = internalMutation({
  args: { now: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(DISPATCH_BATCH_SIZE, Math.floor(args.limit)),
    );
    const claims: WakeClaim[] = [];
    const retries = await ctx.db
      .query("loopWakeReceipts")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .take(100);
    for (const receipt of retries) {
      if ((receipt.attempt ?? 1) >= MAX_ATTEMPTS) {
        await ctx.db.patch(receipt._id, {
          status: "timed_out",
          detail: receipt.detail ?? "Loop failed after three attempts",
          updatedAt: args.now,
        });
        continue;
      }
      if (claims.length >= limit) break;
      if (!receipt.loopId || !receipt.scheduledFor) continue;
      await ctx.db.patch(receipt._id, {
        status: "reserved",
        attempt: (receipt.attempt ?? 1) + 1,
        detail: undefined,
        updatedAt: args.now,
      });
      claims.push({
        tenantId: receipt.tenantId,
        wakeId: receipt.wakeId,
        loopId: receipt.loopId,
        scheduledFor: receipt.scheduledFor,
      });
    }
    if (claims.length >= limit) return claims;
    const registrations = await ctx.db
      .query("loopWakeRegistrations")
      .withIndex("by_next_due", (q) => q.lte("nextDueAt", args.now))
      .take(Math.max(0, limit - claims.length));
    for (const registration of registrations) {
      if (!registration.nextDueAt || !registration.trigger) continue;
      if (
        claims.some(
          (claim) =>
            claim.tenantId === registration.tenantId &&
            claim.loopId === registration.loopId,
        )
      ) {
        continue;
      }
      const scheduledFor = registration.nextDueAt;
      const wakeId = `loop-wake-${registration._id}-${Date.parse(scheduledFor)}`;
      const existing = await ctx.db
        .query("loopWakeReceipts")
        .withIndex("by_wake", (q) =>
          q.eq("tenantId", registration.tenantId).eq("wakeId", wakeId),
        )
        .unique();
      if (existing) {
        if (existing.status === "failed") {
          await ctx.db.patch(existing._id, {
            status: "reserved",
            detail: undefined,
            updatedAt: args.now,
          });
          claims.push({
            tenantId: registration.tenantId,
            wakeId,
            loopId: registration.loopId,
            scheduledFor,
          });
        }
        continue;
      }
      await ctx.db.insert("loopWakeReceipts", {
        wakeId,
        tenantId: registration.tenantId,
        slot: scheduledFor,
        loopId: registration.loopId,
        scheduledFor,
        attempt: 1,
        status: "reserved",
        createdAt: args.now,
        updatedAt: args.now,
      });
      await ctx.db.patch(registration._id, {
        nextDueAt: nextLoopRunAt(
          registration.trigger as Extract<Trigger, { type: "schedule" }>,
          new Date(scheduledFor),
        ),
        updatedAt: args.now,
      });
      claims.push({
        tenantId: registration.tenantId,
        wakeId,
        loopId: registration.loopId,
        scheduledFor,
      });
    }
    return claims;
  },
});

export const finishWake = internalMutation({
  args: {
    tenantId: v.string(),
    wakeId: v.string(),
    status: v.union(
      v.literal("shadow"),
      v.literal("accepted"),
      v.literal("failed"),
    ),
    detail: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const receipt = await ctx.db
      .query("loopWakeReceipts")
      .withIndex("by_wake", (q) =>
        q.eq("tenantId", args.tenantId).eq("wakeId", args.wakeId),
      )
      .unique();
    if (!receipt || receipt.status !== "reserved") {
      throw new Error("Loop wake reservation is not active");
    }
    await ctx.db.patch(receipt._id, {
      status: args.status,
      detail: args.detail.slice(0, 200),
      updatedAt: args.now,
    });
  },
});

export const expireStale = internalMutation({
  args: { now: v.string() },
  handler: async (ctx, args) => {
    const nowMs = Date.parse(args.now);
    const policies = [
      {
        status: "reserved" as const,
        cutoff: new Date(nowMs - 2 * 60_000).toISOString(),
      },
      {
        status: "accepted" as const,
        cutoff: new Date(nowMs - 15 * 60_000).toISOString(),
      },
      {
        status: "running" as const,
        cutoff: new Date(nowMs - 6 * 3_600_000).toISOString(),
      },
    ];
    let expired = 0;
    for (const policy of policies) {
      const rows = await ctx.db
        .query("loopWakeReceipts")
        .withIndex("by_status", (q) =>
          q.eq("status", policy.status).lt("updatedAt", policy.cutoff),
        )
        .take(DISPATCH_BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.patch(row._id, {
          status: "failed",
          detail: `${policy.status} execution timed out`,
          updatedAt: args.now,
        });
        expired += 1;
      }
    }
    return expired;
  },
});

export const markExecution = mutation({
  args: {
    tenantId: v.string(),
    wakeId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    detail: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const receipt = await ctx.db
      .query("loopWakeReceipts")
      .withIndex("by_wake", (q) =>
        q.eq("tenantId", args.tenantId).eq("wakeId", args.wakeId),
      )
      .unique();
    if (!receipt) throw new Error("Loop wake receipt not found");
    await ctx.db.patch(receipt._id, {
      status: args.status,
      detail: args.detail.slice(0, 200),
      updatedAt: args.updatedAt,
    });
  },
});

export const dispatchDue = internalAction({
  args: {},
  handler: async (ctx): Promise<WakeDispatchSummary> => {
    const now = new Date();
    await ctx.runMutation(internal.loopWakes.expireStale, {
      now: now.toISOString(),
    });
    const claims: WakeClaim[] = await ctx.runMutation(
      internal.loopWakes.claimDue,
      {
        now: now.toISOString(),
        limit: DISPATCH_BATCH_SIZE,
      },
    );
    const mode =
      process.env.KODY_LOOP_WAKE_MODE === "dispatch" ? "dispatch" : "shadow";
    if (mode === "shadow") {
      await Promise.all(
        claims.map((claim) =>
          ctx.runMutation(internal.loopWakes.finishWake, {
            wakeId: claim.wakeId,
            tenantId: claim.tenantId,
            status: "shadow",
            detail: "shadow wake recorded",
            now: new Date().toISOString(),
          }),
        ),
      );
      return { mode, claimed: claims.length, dispatched: 0 };
    }

    const dashboardUrl = process.env.KODY_LOOP_DASHBOARD_URL?.trim();
    const wakeApiKey = process.env.KODY_LOOP_WAKE_API_KEY?.trim();
    if (!dashboardUrl || !wakeApiKey) {
      throw new Error("Loop wake Dashboard configuration is missing");
    }
    const outcomes = await Promise.all(
      claims.map(async (claim) => {
        try {
          const outcome = await dispatchLoopWakeToDashboard(claim, {
            dashboardUrl,
            wakeApiKey,
          });
          await ctx.runMutation(internal.loopWakes.finishWake, {
            wakeId: claim.wakeId,
            tenantId: claim.tenantId,
            status: outcome.ok ? "accepted" : "failed",
            detail: outcome.detail,
            now: new Date().toISOString(),
          });
          return outcome.ok;
        } catch {
          await ctx.runMutation(internal.loopWakes.finishWake, {
            wakeId: claim.wakeId,
            tenantId: claim.tenantId,
            status: "failed",
            detail: "Dashboard dispatch failed",
            now: new Date().toISOString(),
          });
          return false;
        }
      }),
    );
    return {
      mode,
      claimed: claims.length,
      dispatched: outcomes.filter(Boolean).length,
    };
  },
});
