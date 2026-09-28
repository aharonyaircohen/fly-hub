import {
  formatPublicAgentFailure,
  PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX,
  PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE,
  type PublicAgentTaskResult,
} from "./public-agent-delegation";
import type { PublicAgentAssignment } from "./public-agent-routing";
import type {
  DurableTurn,
  ProjectAssessmentSynthesisRecovery,
} from "../durable-turn";
import { createDurableTurnProgressRecorder } from "../durable-turn-progress";
type FailedPublicAgentTaskResult = Extract<
  PublicAgentTaskResult,
  { status: "failed" }
>;

export interface PublicAgentActivity {
  id: string;
  assignment: PublicAgentAssignment;
  title: string;
}

type PublicAgentStreamEvent =
  | {
      type: "data-subagent-activity";
      data: {
        id: string;
        phase: "started" | "heartbeat" | "reasoning" | "completed" | "failed";
        agentTitle: string;
        task?: string;
        reasoning?: string;
        reasoningDelta?: string;
        errorText?: string;
      };
    }
  | { type: "text-start" | "text-end"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | {
      type: "tool-input-available";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-output-available";
      toolCallId: string;
      output: unknown;
    }
  | { type: "data-chat-output-contract"; data: { mode: "exclusive-tool" } };

export interface PublicAgentResponseWriter {
  write(event: PublicAgentStreamEvent): void;
}

type PublicAgentDurableTurn = Pick<
  DurableTurn,
  "recordProgress" | "saveRecovery" | "complete" | "fail"
>;

interface WritePublicAgentResponseOptions {
  writer: PublicAgentResponseWriter;
  traceId: string;
  messageId: string;
  activities: readonly PublicAgentActivity[];
  heartbeatMs?: number;
  runOrchestration(
    onReasoningDelta: (event: {
      agent: string;
      assignmentIndex: number;
      delta: string;
    }) => void,
  ): Promise<{
    parentTools: Record<string, unknown>;
    results: PublicAgentTaskResult[];
  }>;
  present?: (
    results: readonly PublicAgentTaskResult[],
    parentTools: Record<string, unknown>,
    writer: PublicAgentResponseWriter,
  ) => Promise<string | null>;
  synthesize(results: readonly PublicAgentTaskResult[]): Promise<string>;
  buildRecovery?: (
    results: readonly PublicAgentTaskResult[],
  ) => ProjectAssessmentSynthesisRecovery | null;
  startDurableTurn?: () => PublicAgentDurableTurn;
  onDurableStartFailure?: (error: unknown) => void;
  onDurableCompleteFailure?: (error: unknown) => void;
  onDurableFailFailure?: (error: unknown) => void;
  onOrchestrationComplete?: (childSessionIds: readonly string[]) => void;
  onOrchestrationFailure?: (error: unknown) => void;
  onSpecialistFailure?: (result: FailedPublicAgentTaskResult) => void;
  onSynthesisFailure?: (error: unknown) => void;
}

export interface PublicAgentResponseOutcome {
  text: string;
  allSpecialistsFailed: boolean;
  returnedFailure: boolean;
  synthesisFailed: boolean;
  childSessionIds: string[];
}

export async function writePublicAgentResponse({
  writer,
  traceId,
  messageId,
  activities,
  heartbeatMs = 30_000,
  runOrchestration,
  present,
  synthesize,
  buildRecovery,
  startDurableTurn,
  onDurableStartFailure,
  onDurableCompleteFailure,
  onDurableFailFailure,
  onOrchestrationComplete,
  onOrchestrationFailure,
  onSpecialistFailure,
  onSynthesisFailure,
}: WritePublicAgentResponseOptions): Promise<PublicAgentResponseOutcome> {
  const streamedReasoningActivities = new Set<string>();
  let durableTurn: PublicAgentDurableTurn | null = null;
  if (startDurableTurn) {
    try {
      durableTurn = startDurableTurn();
    } catch (error) {
      onDurableStartFailure?.(error);
    }
  }
  const durableProgress = createDurableTurnProgressRecorder(durableTurn);
  for (const activity of activities) {
    durableProgress.upsertTool({
      id: activity.id,
      name: "subagent",
      arguments: { task: activity.assignment.task },
      description: "Working on delegated specialist research.",
      status: "running" as const,
      activityKind: "subagent" as const,
      displayName: activity.title,
    });
  }

  for (const activity of activities) {
    writer.write({
      type: "data-subagent-activity",
      data: {
        id: activity.id,
        phase: "started",
        agentTitle: activity.title,
        task: activity.assignment.task,
      },
    });
  }

  let orchestration: {
    parentTools: Record<string, unknown>;
    results: PublicAgentTaskResult[];
  };
  let heartbeatIndex = 0;
  const heartbeat = setInterval(() => {
    const activity = activities[heartbeatIndex % activities.length];
    heartbeatIndex += 1;
    if (!activity) return;
    writer.write({
      type: "data-subagent-activity",
      data: {
        id: activity.id,
        phase: "heartbeat",
        agentTitle: activity.title,
      },
    });
  }, heartbeatMs);
  try {
    orchestration = await runOrchestration(
      ({ agent, assignmentIndex, delta }) => {
        const activity = activities[assignmentIndex];
        if (!activity || activity.assignment.agent !== agent || !delta) return;
        if (!streamedReasoningActivities.has(activity.id)) {
          durableProgress.appendReasoning(`${activity.title}:\n`);
        }
        streamedReasoningActivities.add(activity.id);
        durableProgress.appendReasoning(delta);
        writer.write({
          type: "data-subagent-activity",
          data: {
            id: activity.id,
            phase: "reasoning",
            agentTitle: activity.title,
            reasoningDelta: delta,
          },
        });
      },
    );
  } catch (error) {
    onOrchestrationFailure?.(error);
    const detail = error instanceof Error ? error.message : String(error);
    orchestration = {
      parentTools: {},
      results: activities.map((activity) => ({
        status: "failed",
        agent: activity.assignment.agent,
        failure: { code: "orchestration_error", detail },
      })),
    };
  }
  const childSessionIds = orchestration.results.flatMap((result) =>
    result.sessionId ? [result.sessionId] : [],
  );
  onOrchestrationComplete?.(childSessionIds);
  const results = activities.map((activity, index): PublicAgentTaskResult => {
    const result = orchestration.results[index];
    if (result?.agent === activity.assignment.agent) return result;
    return {
      status: "failed",
      agent: activity.assignment.agent,
      failure: {
        code: "missing_result",
        detail: "No matching result was returned for the delegated assignment.",
      },
    };
  });
  const failures = results.filter(
    (result): result is FailedPublicAgentTaskResult =>
      result.status === "failed",
  );
  const failureMessages = results.map((result) => {
    if (result.status !== "failed") return undefined;
    onSpecialistFailure?.(result);
    return `${formatPublicAgentFailure(result.failure.code)} (trace ${traceId})`;
  });

  for (const [index, activity] of activities.entries()) {
    const result = results[index];
    const failed = result?.status === "failed";
    durableProgress.finishTool(activity.id, failed ? "error" : "success");
    if (
      result?.status === "completed" &&
      result.reasoning?.trim() &&
      !streamedReasoningActivities.has(activity.id)
    ) {
      durableProgress.appendReasoning(
        `${activity.title}:\n${result.reasoning.trim()}\n\n`,
      );
    }
    writer.write({
      type: "data-subagent-activity",
      data: {
        id: activity.id,
        phase: failed ? "failed" : "completed",
        agentTitle: activity.title,
        ...(result?.reasoning && !streamedReasoningActivities.has(activity.id)
          ? { reasoning: result.reasoning }
          : {}),
        ...(failed ? { errorText: failureMessages[index] } : {}),
      },
    });
  }

  const allSpecialistsFailed =
    results.length > 0 && failures.length === results.length;
  const canRecoverEmptyResults =
    allSpecialistsFailed &&
    failures.every(
      (result) =>
        result.failure.code === "empty_result" &&
        Boolean(result.reference?.trim() || result.evidence?.trim()),
    );
  const returnedFailure = allSpecialistsFailed && !canRecoverEmptyResults;

  if (!returnedFailure && durableTurn && buildRecovery) {
    const recovery = buildRecovery(results);
    if (recovery) {
      try {
        await durableTurn.saveRecovery(recovery);
      } catch (error) {
        onDurableCompleteFailure?.(error);
      }
    }
  }

  let text: string;
  let presentationWritten = false;
  if (returnedFailure) {
    text = `${activities
      .map(
        (activity, index) =>
          `${activity.title} failed: ${failureMessages[index] ?? `The specialist model request failed. Retry or choose another model. (trace ${traceId})`}`,
      )
      .join("\n\n")}\n\nWould you like me to retry or use another model?`;
  } else {
    if (present) {
      try {
        const presentedText = await present(
          results,
          orchestration.parentTools,
          writer,
        );
        if (presentedText === null) {
          text = await synthesize(results);
        } else {
          text = presentedText;
          presentationWritten = true;
        }
      } catch (error) {
        onSynthesisFailure?.(error);
        try {
          text = await synthesize(results);
        } catch (synthesisError) {
          onSynthesisFailure?.(synthesisError);
          text = PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE;
        }
      }
    } else {
      try {
        text = await synthesize(results);
      } catch (error) {
        onSynthesisFailure?.(error);
        text = PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE;
      }
    }
  }
  clearInterval(heartbeat);
  const synthesisFailed =
    text.startsWith(PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX) ||
    text.trim() === PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE;

  if (!presentationWritten) {
    writer.write({ type: "text-start", id: messageId });
    writer.write({ type: "text-delta", id: messageId, delta: text });
    writer.write({ type: "text-end", id: messageId });
  }
  if (durableTurn) {
    try {
      if (returnedFailure || synthesisFailed) {
        const errorCode = synthesisFailed
          ? "specialist_synthesis_failed"
          : failures.some(
                (result) => result.failure.code === "orchestration_error",
              )
            ? "specialist_orchestration_failed"
            : "specialist_failed";
        if (synthesisFailed) {
          await durableTurn.fail(errorCode, text);
        } else {
          await durableTurn.fail(errorCode);
        }
      } else {
        await durableTurn.complete(text);
      }
    } catch (error) {
      if (returnedFailure) onDurableFailFailure?.(error);
      else onDurableCompleteFailure?.(error);
    }
  }

  return {
    text,
    allSpecialistsFailed,
    returnedFailure,
    synthesisFailed,
    childSessionIds,
  };
}
