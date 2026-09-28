import { randomBytes } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type { PublicAgentTaskResult } from "./public-agent-delegation";
import type { PublicDelegationAgent } from "./public-agent-definition";
import type { PublicAgentRouteDecision } from "./public-agent-routing";
import type {
  DurableTurn,
  ProjectAssessmentSynthesisRecovery,
} from "../durable-turn";
import {
  writePublicAgentResponse,
  type PublicAgentResponseWriter,
  type PublicAgentResponseOutcome,
} from "./public-agent-response";

type FailedPublicAgentTaskResult = Extract<
  PublicAgentTaskResult,
  { status: "failed" }
>;

type PublicAgentDurableTurn = Pick<
  DurableTurn,
  "recordProgress" | "saveRecovery" | "complete" | "fail"
>;

interface PublicAgentOrchestrationResult {
  parentTools: Record<string, unknown>;
  results: PublicAgentTaskResult[];
}

interface HandlePublicAgentChatOptions {
  traceId: string;
  assignedAgents: readonly PublicDelegationAgent[];
  route(): Promise<PublicAgentRouteDecision>;
  orchestrate(
    decision: PublicAgentRouteDecision,
    onReasoningDelta: (event: {
      agent: string;
      assignmentIndex: number;
      delta: string;
    }) => void,
  ): Promise<PublicAgentOrchestrationResult>;
  synthesize(
    decision: Extract<PublicAgentRouteDecision, { mode: "delegate" }>,
    results: readonly PublicAgentTaskResult[],
  ): Promise<string>;
  buildRecovery?: (
    decision: Extract<PublicAgentRouteDecision, { mode: "delegate" }>,
    results: readonly PublicAgentTaskResult[],
  ) => ProjectAssessmentSynthesisRecovery | null;
  present?: (
    decision: Extract<PublicAgentRouteDecision, { mode: "delegate" }>,
    results: readonly PublicAgentTaskResult[],
    parentTools: Record<string, unknown>,
    writer: PublicAgentResponseWriter,
  ) => Promise<string | null>;
  startDurableTurn?: () => PublicAgentDurableTurn;
  formatStreamError(error: unknown): string;
  onDurableStartFailure?: (error: unknown) => void;
  onDurableCompleteFailure?: (error: unknown) => void;
  onDurableFailFailure?: (error: unknown) => void;
  onOrchestrationComplete?: (
    decision: PublicAgentRouteDecision,
    childSessionIds: readonly string[],
  ) => void;
  onOrchestrationFailure?: (error: unknown) => void;
  onSpecialistFailure?: (result: FailedPublicAgentTaskResult) => void;
  onSynthesisFailure?: (error: unknown) => void;
  onFinished?: (outcome: PublicAgentResponseOutcome) => void;
  onStreamError?: (error: unknown) => void;
}

export type PublicAgentChatResult =
  | { mode: "self"; parentTools: Record<string, unknown> }
  | { mode: "delegated"; response: Response };

/** Owns the complete specialist chat protocol; the route only supplies runtime adapters. */
export async function handlePublicAgentChat({
  traceId,
  assignedAgents,
  route,
  orchestrate,
  synthesize,
  buildRecovery,
  present,
  startDurableTurn,
  formatStreamError,
  onDurableStartFailure,
  onDurableCompleteFailure,
  onDurableFailFailure,
  onOrchestrationComplete,
  onOrchestrationFailure,
  onSpecialistFailure,
  onSynthesisFailure,
  onFinished,
  onStreamError,
}: HandlePublicAgentChatOptions): Promise<PublicAgentChatResult> {
  const decision = await route();
  const runOrchestration = (
    onReasoningDelta: (event: {
      agent: string;
      assignmentIndex: number;
      delta: string;
    }) => void,
  ) => orchestrate(decision, onReasoningDelta);

  if (decision.mode === "self") {
    const result = await runOrchestration(() => undefined);
    onOrchestrationComplete?.(decision, []);
    return { mode: "self", parentTools: result.parentTools };
  }

  const agentsBySlug = new Map(
    assignedAgents.map((agent) => [agent.slug, agent] as const),
  );
  const activities = decision.assignments.map((assignment, index) => ({
    id: `subagent-${index}-${randomBytes(4).toString("hex")}`,
    assignment,
    title: agentsBySlug.get(assignment.agent)?.title ?? assignment.agent,
  }));
  const messageId = `specialist-${randomBytes(8).toString("hex")}`;
  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      const outcome = await writePublicAgentResponse({
        writer: { write: (event) => writer.write(event) },
        traceId,
        messageId,
        activities,
        runOrchestration,
        ...(present
          ? {
              present: (results, parentTools, responseWriter) =>
                present(decision, results, parentTools, responseWriter),
            }
          : {}),
        synthesize: (results) => synthesize(decision, results),
        ...(buildRecovery
          ? { buildRecovery: (results) => buildRecovery(decision, results) }
          : {}),
        startDurableTurn,
        onDurableStartFailure,
        onDurableCompleteFailure,
        onDurableFailFailure,
        onOrchestrationComplete: (childSessionIds) =>
          onOrchestrationComplete?.(decision, childSessionIds),
        onOrchestrationFailure,
        onSpecialistFailure,
        onSynthesisFailure,
      });
      onFinished?.(outcome);
    },
    onError: (error) => {
      onStreamError?.(error);
      return formatStreamError(error);
    },
  });

  return {
    mode: "delegated",
    response: createUIMessageStreamResponse({ stream: uiStream }),
  };
}
