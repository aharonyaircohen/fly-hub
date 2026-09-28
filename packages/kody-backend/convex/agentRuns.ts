import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { serviceMutation as mutation, serviceQuery as query } from "./lib/auth";

const outcomeValidator = v.union(
  v.literal("success"),
  v.literal("rejected"),
  v.literal("error"),
);
const IDLE_RUN_MS = 15 * 60 * 1_000;

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

async function findRun(ctx: DbCtx, tenantId: string, runId: string) {
  return await ctx.db
    .query("agentRuns")
    .withIndex("by_run", (q) => q.eq("tenantId", tenantId).eq("runId", runId))
    .unique();
}

export const begin = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    tokenId: v.string(),
    agentName: v.string(),
    clientName: v.optional(v.string()),
    startedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await findRun(ctx, args.tenantId, args.runId);
    if (existing) return existing.runId;
    await ctx.db.insert("agentRuns", {
      ...args,
      status: "running",
      callCount: 0,
      lastActivityAt: args.startedAt,
    });
    return args.runId;
  },
});

export const recordCall = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    tokenId: v.string(),
    agentName: v.string(),
    clientName: v.optional(v.string()),
    workRecordId: v.optional(v.string()),
    eventId: v.string(),
    method: v.string(),
    toolName: v.optional(v.string()),
    actionId: v.optional(v.string()),
    outcome: outcomeValidator,
    occurredAt: v.string(),
  },
  handler: async (ctx, args) => {
    const duplicate = await ctx.db
      .query("mcpAuditEvents")
      .withIndex("by_event", (q) =>
        q.eq("tenantId", args.tenantId).eq("eventId", args.eventId),
      )
      .unique();
    if (duplicate) return args.runId;

    const existing = await findRun(ctx, args.tenantId, args.runId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.clientName && !existing.clientName
          ? { clientName: args.clientName }
          : {}),
        ...(args.workRecordId ? { workRecordId: args.workRecordId } : {}),
        status: "running",
        callCount: existing.callCount + 1,
        lastOutcome: args.outcome,
        lastActivityAt: args.occurredAt,
        endedAt: undefined,
      });
    } else {
      await ctx.db.insert("agentRuns", {
        runId: args.runId,
        tenantId: args.tenantId,
        tokenId: args.tokenId,
        agentName: args.agentName,
        ...(args.clientName ? { clientName: args.clientName } : {}),
        ...(args.workRecordId ? { workRecordId: args.workRecordId } : {}),
        status: "running",
        callCount: 1,
        lastOutcome: args.outcome,
        startedAt: args.occurredAt,
        lastActivityAt: args.occurredAt,
      });
    }
    await ctx.db.insert("mcpAuditEvents", {
      eventId: args.eventId,
      tenantId: args.tenantId,
      runId: args.runId,
      tokenId: args.tokenId,
      actorLogin: args.agentName,
      method: args.method,
      ...(args.toolName ? { toolName: args.toolName } : {}),
      ...(args.actionId ? { actionId: args.actionId } : {}),
      outcome: args.outcome,
      occurredAt: args.occurredAt,
    });
    return args.runId;
  },
});

export const finish = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    endedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await findRun(ctx, args.tenantId, args.runId);
    if (!run) return false;
    await ctx.db.patch(run._id, {
      status: args.status,
      endedAt: args.endedAt,
      lastActivityAt: args.endedAt,
    });
    return true;
  },
});

export const listDetailed = query({
  args: {
    tenantId: v.string(),
    limit: v.number(),
    now: v.string(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const storedRuns = await ctx.db
      .query("agentRuns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);
    const runs = await Promise.all(
      storedRuns.map(async (run) => {
        const calls = await ctx.db
          .query("mcpAuditEvents")
          .withIndex("by_run", (q) =>
            q.eq("tenantId", args.tenantId).eq("runId", run.runId),
          )
          .order("asc")
          .collect();
        const work = run.workRecordId
          ? await ctx.db
              .query("repoDocs")
              .withIndex("by_kind", (q) =>
                q
                  .eq("tenantId", args.tenantId)
                  .eq("kind", `todo:${run.workRecordId}`),
              )
              .unique()
          : null;
        const record = work?.doc as
          | {
              title?: string;
              description?: string;
              mcpWork?: { summary?: string; status?: string };
              items?: Array<{
                meta?: {
                  mcpWorkEvent?: {
                    type?: string;
                    payload?: Record<string, unknown>;
                    recordedAt?: string;
                  };
                };
              }>;
            }
          | undefined;
        const workEvents = (record?.items ?? []).flatMap((item) => {
          const event = item.meta?.mcpWorkEvent;
          return event?.payload && event.recordedAt ? [event] : [];
        });
        const evidence = workEvents
          .filter((event) => event.type === "evidence")
          .map((event) => ({ ...event.payload, recordedAt: event.recordedAt }));
        const handoff = workEvents
          .filter((event) => event.type === "handoff")
          .at(-1);
        const stale =
          run.status === "running" &&
          Date.parse(args.now) - Date.parse(run.lastActivityAt) >= IDLE_RUN_MS;
        const status = stale ? "completed" : run.status;
        return {
          runId: run.runId,
          agentName: run.agentName,
          ...(run.clientName ? { clientName: run.clientName } : {}),
          repository: run.tenantId,
          ...(run.workRecordId ? { workRecordId: run.workRecordId } : {}),
          ...(record?.title ? { workTitle: record.title } : {}),
          startedAt: run.startedAt,
          lastActivityAt: run.lastActivityAt,
          ...(run.endedAt || stale
            ? { endedAt: run.endedAt ?? run.lastActivityAt }
            : {}),
          status,
          summary:
            record?.mcpWork?.summary ||
            record?.description ||
            `${run.callCount} MCP ${run.callCount === 1 ? "call" : "calls"}`,
          result:
            status === "running"
              ? (record?.mcpWork?.status ?? run.lastOutcome ?? "running")
              : status,
          callCount: run.callCount,
          evidence,
          ...(handoff
            ? {
                handoff: { ...handoff.payload, recordedAt: handoff.recordedAt },
              }
            : {}),
          calls: calls.map(
            ({ _id, _creationTime, tokenId, tenantId, runId, ...call }) => call,
          ),
        };
      }),
    );

    const legacyCalls = (
      await ctx.db
        .query("mcpAuditEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .order("desc")
        .take(500)
    ).filter((call) => !call.runId);
    const legacyRuns = legacyCalls
      .slice(0, Math.max(0, limit - runs.length))
      .map(({ _id, _creationTime, tokenId, tenantId, runId, ...call }) => ({
        runId: `legacy-${call.eventId}`,
        agentName: call.actorLogin,
        repository: args.tenantId,
        startedAt: call.occurredAt,
        lastActivityAt: call.occurredAt,
        endedAt: call.occurredAt,
        status: "completed" as const,
        summary: "Earlier MCP activity",
        result: call.outcome,
        callCount: 1,
        evidence: [],
        calls: [call],
      }));
    return {
      runs: [...runs, ...legacyRuns].slice(0, limit),
      computedAt: args.now,
    };
  },
});

export const remove = mutation({
  args: {
    tenantId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", args.runId),
      )
      .unique();
    const calls = await ctx.db
      .query("mcpAuditEvents")
      .withIndex("by_run", (q) =>
        q.eq("tenantId", args.tenantId).eq("runId", args.runId),
      )
      .collect();
    for (const call of calls) await ctx.db.delete(call._id);
    if (run) await ctx.db.delete(run._id);
    return { removed: Boolean(run), callsRemoved: calls.length };
  },
});
