import type { DurableTurn, DurableTurnProgress } from "./durable-turn";

type DurableToolProgress = DurableTurnProgress["toolCalls"][number];
type DurableProgressSink = Pick<DurableTurn, "recordProgress">;

export interface DurableTurnProgressRecorder {
  appendReasoning(delta: string): void;
  upsertTool(toolCall: DurableToolProgress): void;
  finishTool(id: string, status: "success" | "error"): void;
}

/** Owns the in-memory snapshot mirrored into the server-owned durable turn. */
export function createDurableTurnProgressRecorder(
  sink: DurableProgressSink | null,
): DurableTurnProgressRecorder {
  let reasoning = "";
  const toolCalls = new Map<string, DurableToolProgress>();
  const publish = () =>
    sink?.recordProgress({ reasoning, toolCalls: [...toolCalls.values()] });

  return {
    appendReasoning(delta) {
      if (!delta) return;
      reasoning += delta;
      publish();
    },
    upsertTool(toolCall) {
      toolCalls.set(toolCall.id, toolCall);
      publish();
    },
    finishTool(id, status) {
      const toolCall = toolCalls.get(id);
      if (!toolCall) return;
      toolCalls.set(id, { ...toolCall, status });
      publish();
    },
  };
}
