import {
  createAgencyRequestState,
  type LoopDefinition,
} from "@kody-ade/agency-domain";
import { v } from "convex/values";

import { serviceQuery as query } from "./lib/auth";

const TODO_PREFIX = "todo:";
const LOOP_PREFIX = "agency-request-";

/** The Todo document, not a scheduler snapshot, owns its monitoring intent. */
export function taskLoopRegistration(kind: string, doc: unknown) {
  if (!kind.startsWith(TODO_PREFIX)) return null;
  const loopId = `${LOOP_PREFIX}${kind.slice(TODO_PREFIX.length)}`;
  let enabled = false;
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const value = (doc as Record<string, unknown>).agencyRequest;
    if (value) {
      try {
        const request = createAgencyRequestState(value);
        enabled =
          request.execution !== undefined &&
          ["running", "monitoring", "blocked"].includes(request.phase) &&
          request.related.some(
            (ref) => ref.kind === "loop" && ref.id === loopId,
          );
      } catch {
        enabled = false;
      }
    }
  }
  return {
    loopId,
    enabled,
    ...(enabled
      ? { trigger: { type: "schedule" as const, every: "15m" } }
      : {}),
  };
}

/** An id prefix only locates the candidate; an actual Todo establishes ownership. */
export function taskKindForLoop(loopId: string): string | null {
  return loopId.startsWith(LOOP_PREFIX)
    ? `${TODO_PREFIX}${loopId.slice(LOOP_PREFIX.length)}`
    : null;
}

export const list = query({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const records = await ctx.db
      .query("repoDocs")
      .withIndex("by_kind", (q) =>
        q
          .eq("tenantId", tenantId)
          .gte("kind", TODO_PREFIX)
          .lt("kind", `${TODO_PREFIX}￿`),
      )
      .take(100);

    const loops: LoopDefinition[] = [];
    for (const record of records) {
      const doc =
        record.doc &&
        typeof record.doc === "object" &&
        !Array.isArray(record.doc)
          ? (record.doc as Record<string, unknown>)
          : null;
      if (!doc?.agencyRequest) continue;
      try {
        const request = createAgencyRequestState(doc.agencyRequest);
        if (
          !request.execution ||
          !["running", "monitoring", "blocked"].includes(request.phase)
        ) {
          continue;
        }
        const loop = request.related.find(
          (ref) => ref.kind === "loop" && ref.id.startsWith(LOOP_PREFIX),
        );
        if (!loop) continue;
        const latestRun = [...request.related]
          .reverse()
          .find((ref) => ref.kind === "run");
        if (latestRun) {
          const workflowRun = await ctx.db
            .query("workflowRuns")
            .withIndex("by_run", (q) =>
              q
                .eq("tenantId", tenantId)
                .eq("workflowId", request.execution!.workflowId)
                .eq("runId", latestRun.id),
            )
            .unique();
          if (
            (!workflowRun && request.phase !== "blocked") ||
            workflowRun?.state.status === "running" ||
            workflowRun?.state.status === "done"
          ) {
            continue;
          }
        }
        loops.push({
          id: loop.id,
          trigger: { type: "schedule" as const, every: "15m" },
          target: {
            kind: "workflow" as const,
            id: request.execution.workflowId,
          },
          input: {
            ...request.execution.input,
            agencyRequest: {
              todoSlug: record.kind.slice(TODO_PREFIX.length),
              outcome: request.requirement.outcome,
              ...(request.requirement.success
                ? { successCriteria: request.requirement.success }
                : {}),
              evidence: request.evidence,
              blockers: request.blockers,
              ...(latestRun ? { previousRunId: latestRun.id } : {}),
            },
          },
          enabled: true,
        });
      } catch {
        continue;
      }
    }
    return loops;
  },
});
