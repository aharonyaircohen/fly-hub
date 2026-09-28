import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { serviceMutation as mutation } from "./lib/auth";

const MAX_ATTEMPTS = 3;
const WORKER_TIMEOUT_MS = 9 * 60_000;
const LEASE_MS = 10 * 60_000;

function newLeaseId(): string {
  return globalThis.crypto.randomUUID();
}

export const enqueue = mutation({
  args: {
    userId: v.string(),
    githubAccount: v.string(),
    githubOwner: v.optional(v.string()),
    githubTokenEncrypted: v.string(),
    operationId: v.string(),
    imageRef: v.string(),
    reset: v.boolean(),
    dashboardUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("brainRestoreJobs")
      .withIndex("by_operation", (q) => q.eq("operationId", args.operationId))
      .unique();
    if (existing) return existing._id;
    const now = new Date().toISOString();
    const jobId = await ctx.db.insert("brainRestoreJobs", {
      ...args,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.brainRestoreJobs.dispatch, { jobId });
    return jobId;
  },
});

export const claim = internalMutation({
  args: { jobId: v.id("brainRestoreJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed") return null;
    const now = new Date().toISOString();
    const nowMs = Date.now();
    if (job.status === "running" && (job.leaseUntilMs ?? 0) > nowMs) return null;
    if (job.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(jobId, {
        status: "failed",
        updatedAt: now,
        error: "Restore worker exhausted its retry budget",
        leaseId: undefined,
        leaseUntilMs: undefined,
      });
      return null;
    }
    const leaseId = newLeaseId();
    await ctx.db.patch(jobId, {
      status: "running",
      attempts: job.attempts + 1,
      updatedAt: now,
      error: undefined,
      leaseId,
      leaseUntilMs: nowMs + LEASE_MS,
    });
    return {
      ...job,
      status: "running" as const,
      attempts: job.attempts + 1,
      leaseId,
      leaseUntilMs: nowMs + LEASE_MS,
    };
  },
});

export const finish = internalMutation({
  args: {
    jobId: v.id("brainRestoreJobs"),
    leaseId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    retryable: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId) return;
    const now = new Date().toISOString();
    if (
      args.status === "failed" &&
      args.retryable !== false &&
      job.attempts < MAX_ATTEMPTS
    ) {
      await ctx.db.patch(args.jobId, {
        status: "queued",
        updatedAt: now,
        error: args.error?.slice(0, 500),
        leaseId: undefined,
        leaseUntilMs: undefined,
      });
      await ctx.scheduler.runAfter(15_000, internal.brainRestoreJobs.dispatch, {
        jobId: args.jobId,
      });
      return;
    }
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: now,
      leaseId: undefined,
      leaseUntilMs: undefined,
      ...(args.error ? { error: args.error.slice(0, 500) } : {}),
    });
  },
});

/** Reclaims jobs whose action disappeared during a dashboard/Convex restart. */
export const requeueStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const running = await ctx.db
      .query("brainRestoreJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    let reclaimed = 0;
    for (const job of running) {
      if ((job.leaseUntilMs ?? 0) > nowMs || job.attempts >= MAX_ATTEMPTS) {
        if (job.attempts >= MAX_ATTEMPTS) {
          await ctx.db.patch(job._id, {
            status: "failed",
            updatedAt: now,
            error: "Restore worker exhausted its retry budget",
            leaseId: undefined,
            leaseUntilMs: undefined,
          });
        }
        continue;
      }
      await ctx.db.patch(job._id, {
        status: "queued",
        updatedAt: now,
        error: "Restore worker was interrupted; retrying",
        leaseId: undefined,
        leaseUntilMs: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.brainRestoreJobs.dispatch, {
        jobId: job._id,
      });
      reclaimed += 1;
    }
    return reclaimed;
  },
});

export const dispatch = internalAction({
  args: { jobId: v.id("brainRestoreJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runMutation(internal.brainRestoreJobs.claim, { jobId });
    if (!job) return;
    const leaseId = job.leaseId;
    if (!leaseId) return;
    const serviceKey = process.env.KODY_SERVICE_KEY?.trim();
    const dashboardUrl = job.dashboardUrl.trim();
    if (!serviceKey || !dashboardUrl) {
      await ctx.runMutation(internal.brainRestoreJobs.finish, {
        jobId,
        leaseId,
        status: "failed",
        error: "Brain restore worker configuration is missing",
      });
      return;
    }
    try {
      const response = await fetch(
        `${dashboardUrl.replace(/\/+$/, "")}/api/kody/brain/image/worker`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userId: job.userId,
            githubAccount: job.githubAccount,
            githubOwner: job.githubOwner,
            githubTokenEncrypted: job.githubTokenEncrypted,
            operationId: job.operationId,
            imageRef: job.imageRef,
            reset: job.reset,
            finalAttempt: job.attempts >= MAX_ATTEMPTS,
          }),
          signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as {
          message?: string;
          error?: string;
        };
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        await ctx.runMutation(internal.brainRestoreJobs.finish, {
          jobId,
          leaseId,
          status: "failed",
          retryable,
          error:
            body.message ??
            body.error ??
            `Dashboard worker rejected restore (HTTP ${response.status})`,
        });
        return;
      }
      await ctx.runMutation(internal.brainRestoreJobs.finish, {
        jobId,
        leaseId,
        status: "completed",
      });
    } catch (error) {
      await ctx.runMutation(internal.brainRestoreJobs.finish, {
        jobId,
        leaseId,
        status: "failed",
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
