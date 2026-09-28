import { tool } from "ai";
import { z } from "zod";

import {
  classifyPublicAgentFailure,
  type PublicAgentTaskResult,
} from "./public-agent-delegation";
import type { PublicDelegationAgent } from "./public-agent-definition";
import type { PublicAgentAssignment } from "./public-agent-routing";
import { PUBLIC_AGENT_TASK_TIMEOUT_MS } from "./public-agent-limits";

const MAX_SPECIALIST_ASSIGNMENTS = 3;
const SPECIALIST_HEARTBEAT_MS = 30_000;

const assignmentSchema = z.object({
  agent: z.string().trim().min(1),
  task: z.string().trim().min(1).max(4_000),
});

function publicFinding(result: PublicAgentTaskResult) {
  if (result.status === "failed") {
    return {
      status: result.status,
      agent: result.agent,
      failure: result.failure.code,
    };
  }
  return {
    status: result.status,
    agent: result.agent,
    ...(result.result ? { result: result.result } : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
    ...(result.internalLinks?.length
      ? { internalLinks: result.internalLinks }
      : {}),
  };
}

export function createPublicAgentEvidenceTool({
  agents,
  run,
  heartbeatMs = SPECIALIST_HEARTBEAT_MS,
}: {
  agents: readonly PublicDelegationAgent[];
  run(
    assignments: PublicAgentAssignment[],
    abortSignal?: AbortSignal,
  ): Promise<PublicAgentTaskResult[]>;
  heartbeatMs?: number;
}) {
  const assignedSlugs = new Set(agents.map((agent) => agent.slug));
  const roster = agents
    .map((agent) => {
      const purpose = agent.whenToUse?.trim() || agent.body.trim();
      return `- ${agent.slug}: ${agent.title}${purpose ? ` — ${purpose}` : ""}`;
    })
    .join("\n");
  let requested = false;

  return tool({
    description: [
      "Ask one or more assigned specialists for focused evidence, then continue this same Kody turn using their returned findings.",
      "Use this only when the request needs specialist expertise or independent evidence; Kody-owned actions and answers from current context stay with Kody.",
      `Assigned specialists:\n${roster}`,
    ].join("\n\n"),
    inputSchema: z.object({
      assignments: z
        .array(assignmentSchema)
        .min(1)
        .max(MAX_SPECIALIST_ASSIGNMENTS),
    }),
    execute: async function* ({ assignments }, options) {
      if (requested) {
        yield {
          status: "rejected" as const,
          error: "Specialist evidence was already requested in this turn.",
        };
        return;
      }
      const unknown = assignments
        .map(({ agent }) => agent)
        .filter((agent) => !assignedSlugs.has(agent));
      if (unknown.length > 0) {
        yield {
          status: "rejected" as const,
          error: `Only assigned specialists may be requested: ${[...new Set(unknown)].join(", ")}.`,
        };
        return;
      }
      if (
        new Set(assignments.map(({ agent }) => agent)).size !==
        assignments.length
      ) {
        yield {
          status: "rejected" as const,
          error: "Request each specialist at most once per evidence call.",
        };
        return;
      }

      requested = true;
      const controller = new AbortController();
      const callerAbortSignal = options?.abortSignal;
      const abortSignal = callerAbortSignal
        ? AbortSignal.any([callerAbortSignal, controller.signal])
        : controller.signal;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol("specialist-task-timeout");
      let results: PublicAgentTaskResult[];
      try {
        const outcomePromise = Promise.race([
          run(assignments, abortSignal),
          new Promise<typeof timedOut>((resolve) => {
            timeout = setTimeout(() => {
              controller.abort(new Error("Specialist task timed out."));
              resolve(timedOut);
            }, PUBLIC_AGENT_TASK_TIMEOUT_MS);
          }),
        ]);
        yield {
          status: "running" as const,
          specialists: assignments.map(({ agent }) => agent),
        };
        const heartbeat = Symbol("specialist-task-heartbeat");
        let outcome: PublicAgentTaskResult[] | typeof timedOut;
        for (;;) {
          let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([
            outcomePromise,
            new Promise<typeof heartbeat>((resolve) => {
              heartbeatTimer = setTimeout(() => resolve(heartbeat), heartbeatMs);
            }),
          ]);
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          if (next === heartbeat) {
            yield {
              status: "running" as const,
              specialists: assignments.map(({ agent }) => agent),
            };
            continue;
          }
          outcome = next;
          break;
        }
        results =
          outcome === timedOut
            ? assignments.map(({ agent }) => ({
                status: "failed" as const,
                agent,
                failure: { code: "timeout" as const },
              }))
            : outcome;
      } catch (error) {
        const failure = classifyPublicAgentFailure(error);
        results = assignments.map(({ agent }) => ({
          status: "failed" as const,
          agent,
          failure,
        }));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      yield {
        status: "completed" as const,
        findings: results.map(publicFinding),
      };
    },
  });
}
