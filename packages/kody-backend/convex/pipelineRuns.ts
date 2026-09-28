import { v } from "convex/values";
import { pipelineRunStepValidator } from "./validators";
import { serviceMutation, serviceQuery } from "./lib/auth";
import type { MutationCtx } from "./_generated/server";

const PIPELINE_CONCURRENCY_LEASE_MS = 7 * 60 * 60 * 1_000;

async function queuedRunFor(
  ctx: MutationCtx,
  input: { tenantId: string; pipelineId: string; concurrencyKey?: string },
) {
  if (!input.concurrencyKey) return null;
  return await ctx.db
    .query("pipelineRuns")
    .withIndex("by_concurrency", (q) =>
      q
        .eq("tenantId", input.tenantId)
        .eq("pipelineId", input.pipelineId)
        .eq("concurrencyKey", input.concurrencyKey)
        .eq("status", "queued"),
    )
    .first();
}

async function promoteQueuedRun(
  ctx: MutationCtx,
  input: { tenantId: string; pipelineId: string; concurrencyKey?: string },
  now: string,
) {
  const queued = await queuedRunFor(ctx, input);
  if (!queued) return null;
  await ctx.db.patch(queued._id, { status: "running", updatedAt: now });
  return {
    kind: "start" as const,
    pipelineId: queued.pipelineId,
    runId: queued.runId,
    stepIndex: 0,
    step: queued.steps[0]!,
    facts: queued.facts ?? queued.input ?? {},
  };
}

export const list = serviceQuery({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, pipelineId, limit }) =>
    await ctx.db
      .query("pipelineRuns")
      .withIndex("by_pipeline", (q) =>
        q.eq("tenantId", tenantId).eq("pipelineId", pipelineId),
      )
      .order("desc")
      .take(Math.min(Math.max(limit ?? 20, 1), 100)),
});

export const get = serviceQuery({
  args: { tenantId: v.string(), pipelineId: v.string(), runId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("pipelineRuns")
      .withIndex("by_run", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("pipelineId", args.pipelineId)
          .eq("runId", args.runId),
      )
      .unique(),
});

export const reserve = serviceMutation({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    runId: v.string(),
    concurrencyKey: v.optional(v.string()),
    facts: v.optional(v.record(v.string(), v.any())),
    input: v.optional(v.record(v.string(), v.any())),
    steps: v.array(pipelineRunStepValidator),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_run", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("pipelineId", args.pipelineId)
          .eq("runId", args.runId),
      )
      .unique();
    if (existing) return { claimed: false, run: existing };
    if (args.concurrencyKey) {
      const running = await ctx.db
        .query("pipelineRuns")
        .withIndex("by_concurrency", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("pipelineId", args.pipelineId)
            .eq("concurrencyKey", args.concurrencyKey)
            .eq("status", "running"),
        )
        .first();
      const waitingApproval = await ctx.db
        .query("pipelineRuns")
        .withIndex("by_concurrency", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("pipelineId", args.pipelineId)
            .eq("concurrencyKey", args.concurrencyKey)
            .eq("status", "waiting-approval"),
        )
        .first();
      const active = running ?? waitingApproval;
      if (active) {
        const activeAt = Date.parse(active.updatedAt);
        const nowAt = Date.parse(args.now);
        const expired =
          active.status === "running" &&
          Number.isFinite(activeAt) &&
          Number.isFinite(nowAt) &&
          nowAt - activeAt >= PIPELINE_CONCURRENCY_LEASE_MS;
        if (!expired) {
          const queued = await queuedRunFor(ctx, args);
          if (queued) {
            await ctx.db.patch(queued._id, {
              status: "cancelled",
              error: "Superseded by a newer waiting Pipeline run.",
              updatedAt: args.now,
            });
          }
          const id = await ctx.db.insert("pipelineRuns", {
            tenantId: args.tenantId,
            pipelineId: args.pipelineId,
            runId: args.runId,
            concurrencyKey: args.concurrencyKey,
            status: "queued",
            facts: args.facts ?? args.input ?? {},
            steps: args.steps,
            currentStepIndex: 0,
            createdAt: args.now,
            updatedAt: args.now,
          });
          return {
            claimed: false,
            queued: true,
            run: await ctx.db.get(id),
          };
        }

        const staleSteps = [...active.steps];
        if (staleSteps[active.currentStepIndex]) {
          staleSteps[active.currentStepIndex] = {
            ...staleSteps[active.currentStepIndex]!,
            status: "failed",
            completedAt: args.now,
          };
        }
        await ctx.db.patch(active._id, {
          status: "failed",
          steps: staleSteps,
          activeWorkflowRunId: undefined,
          error: "Pipeline run expired while still active.",
          updatedAt: args.now,
        });
        const queued = await queuedRunFor(ctx, args);
        if (queued) {
          await ctx.db.patch(queued._id, {
            status: "cancelled",
            error: "Superseded by a newer Pipeline run.",
            updatedAt: args.now,
          });
        }
      }
    }
    const id = await ctx.db.insert("pipelineRuns", {
      tenantId: args.tenantId,
      pipelineId: args.pipelineId,
      runId: args.runId,
      concurrencyKey: args.concurrencyKey,
      status: "running",
      facts: args.facts ?? args.input ?? {},
      steps: args.steps,
      currentStepIndex: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { claimed: true, run: await ctx.db.get(id) };
  },
});

export const markDispatched = serviceMutation({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    runId: v.string(),
    stepIndex: v.number(),
    workflowRunId: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_run", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("pipelineId", args.pipelineId)
          .eq("runId", args.runId),
      )
      .unique();
    if (
      !run ||
      run.status !== "running" ||
      run.currentStepIndex !== args.stepIndex ||
      !run.steps[args.stepIndex]
    ) {
      return false;
    }
    const steps = [...run.steps];
    steps[args.stepIndex] = {
      ...steps[args.stepIndex]!,
      status: "running",
      workflowRunId: args.workflowRunId,
      startedAt: args.now,
    };
    await ctx.db.patch(run._id, {
      steps,
      activeWorkflowRunId: args.workflowRunId,
      updatedAt: args.now,
    });
    return true;
  },
});

export const failDispatch = serviceMutation({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    runId: v.string(),
    error: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_run", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("pipelineId", args.pipelineId)
          .eq("runId", args.runId),
      )
      .unique();
    if (!run || run.status !== "running") return false;
    const steps = [...run.steps];
    if (steps[run.currentStepIndex]) {
      steps[run.currentStepIndex] = {
        ...steps[run.currentStepIndex]!,
        status: "failed",
        completedAt: args.now,
      };
    }
    await ctx.db.patch(run._id, {
      status: "failed",
      steps,
      activeWorkflowRunId: undefined,
      error: args.error.slice(0, 2000),
      updatedAt: args.now,
    });
    return await promoteQueuedRun(ctx, run, args.now);
  },
});

export const advance = serviceMutation({
  args: {
    tenantId: v.string(),
    workflowRunId: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    output: v.record(v.string(), v.any()),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_active_workflow", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("activeWorkflowRunId", args.workflowRunId),
      )
      .unique();
    if (!run || run.status !== "running") return null;
    const current = run.steps[run.currentStepIndex];
    if (!current || current.workflowRunId !== args.workflowRunId) return null;

    const steps = [...run.steps];
    steps[run.currentStepIndex] = {
      ...current,
      status:
        args.status === "success"
          ? "done"
          : args.status === "blocked"
            ? "blocked"
            : "failed",
      completedAt: args.now,
      output: args.output,
    };
    if (args.status !== "success") {
      await ctx.db.patch(run._id, {
        status: args.status,
        steps,
        activeWorkflowRunId: undefined,
        error: `Workflow ${current.workflowId} ${args.status}.`,
        updatedAt: args.now,
      });
      return (
        (await promoteQueuedRun(ctx, run, args.now)) ?? {
          kind: args.status as "failed" | "blocked",
        }
      );
    }
    const nextIndex = run.currentStepIndex + 1;
    const next = steps[nextIndex];
    const facts = { ...(run.facts ?? run.input ?? {}), ...args.output };
    const decision = current.decisionFact
      ? args.output[current.decisionFact]
      : "continue";
    if (
      current.decisionFact &&
      decision !== "continue" &&
      decision !== "stop" &&
      decision !== "approval"
    ) {
      await ctx.db.patch(run._id, {
        status: "failed",
        steps,
        facts,
        activeWorkflowRunId: undefined,
        error: `Workflow ${current.workflowId} returned an invalid Pipeline decision.`,
        updatedAt: args.now,
      });
      return (
        (await promoteQueuedRun(ctx, run, args.now)) ?? {
          kind: "failed" as const,
        }
      );
    }
    if (decision === "stop") {
      for (let index = nextIndex; index < steps.length; index += 1) {
        steps[index] = { ...steps[index]!, status: "cancelled" };
      }
      await ctx.db.patch(run._id, {
        status: "done",
        steps,
        facts,
        activeWorkflowRunId: undefined,
        updatedAt: args.now,
      });
      return (
        (await promoteQueuedRun(ctx, run, args.now)) ?? {
          kind: "done" as const,
        }
      );
    }
    if (decision === "approval") {
      if (!next) {
        await ctx.db.patch(run._id, {
          status: "done",
          steps,
          facts,
          activeWorkflowRunId: undefined,
          updatedAt: args.now,
        });
        return (
          (await promoteQueuedRun(ctx, run, args.now)) ?? {
            kind: "done" as const,
          }
        );
      }
      await ctx.db.patch(run._id, {
        status: "waiting-approval",
        steps,
        facts,
        activeWorkflowRunId: undefined,
        updatedAt: args.now,
      });
      return {
        kind: "approval" as const,
        pipelineId: run.pipelineId,
        runId: run.runId,
        stepIndex: nextIndex,
        step: next,
        facts,
      };
    }
    if (!next) {
      await ctx.db.patch(run._id, {
        status: "done",
        steps,
        facts,
        activeWorkflowRunId: undefined,
        updatedAt: args.now,
      });
      return (
        (await promoteQueuedRun(ctx, run, args.now)) ?? {
          kind: "done" as const,
        }
      );
    }
    await ctx.db.patch(run._id, {
      steps,
      facts,
      currentStepIndex: nextIndex,
      activeWorkflowRunId: undefined,
      updatedAt: args.now,
    });
    return {
      kind: "next" as const,
      pipelineId: run.pipelineId,
      runId: run.runId,
      stepIndex: nextIndex,
      step: next,
      facts,
      // Temporary compatibility for a Dashboard deployed before this backend.
      input: facts,
      previousOutput: args.output,
    };
  },
});

export const decide = serviceMutation({
  args: {
    tenantId: v.string(),
    pipelineId: v.string(),
    runId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    decidedBy: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_run", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("pipelineId", args.pipelineId)
          .eq("runId", args.runId),
      )
      .unique();
    if (!run || run.status !== "waiting-approval") return null;
    const nextIndex = run.currentStepIndex + 1;
    const steps = [...run.steps];
    if (args.decision === "reject") {
      for (let index = nextIndex; index < steps.length; index += 1) {
        steps[index] = { ...steps[index]!, status: "cancelled" };
      }
      await ctx.db.patch(run._id, {
        status: "cancelled",
        steps,
        error: `Pipeline delivery rejected by ${args.decidedBy}.`,
        updatedAt: args.now,
      });
      return {
        kind: "rejected" as const,
        next: await promoteQueuedRun(ctx, run, args.now),
      };
    }
    const next = steps[nextIndex];
    if (!next) return null;
    await ctx.db.patch(run._id, {
      status: "running",
      currentStepIndex: nextIndex,
      updatedAt: args.now,
    });
    return {
      kind: "next" as const,
      pipelineId: run.pipelineId,
      runId: run.runId,
      stepIndex: nextIndex,
      step: next,
      facts: run.facts ?? run.input ?? {},
    };
  },
});
