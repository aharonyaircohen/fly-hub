import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

export type ModelCallPhase =
  | "started"
  | "first_response"
  | "completed"
  | "failed";

export interface ModelCallEvent {
  callId: string;
  phase: ModelCallPhase;
  operation: "generate" | "stream";
  provider: string;
  modelId: string;
  elapsedMs: number;
  providerRequestId?: string;
  error?: unknown;
}

export interface ModelCallObserverOptions {
  onEvent(event: ModelCallEvent): void;
}

function providerRequestId(part: LanguageModelV3StreamPart): string | undefined {
  return part.type === "response-metadata" && typeof part.id === "string"
    ? part.id
    : undefined;
}

function observedStream(
  result: LanguageModelV3StreamResult,
  emit: (phase: ModelCallPhase, details?: Partial<ModelCallEvent>) => void,
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = result.stream.getReader();
  let receivedFirstResponse = false;
  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          emit("completed");
          controller.close();
          reader.releaseLock();
          return;
        }
        if (!receivedFirstResponse) {
          receivedFirstResponse = true;
          emit("first_response", {
            providerRequestId: providerRequestId(next.value),
          });
        }
        controller.enqueue(next.value);
      } catch (error) {
        emit("failed", { error });
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      reader.releaseLock();
    },
  });
}

export function observeLanguageModelCalls(
  model: LanguageModelV3,
  options: ModelCallObserverOptions,
): LanguageModelV3 {
  let callSequence = 0;

  function callObserver(operation: ModelCallEvent["operation"]) {
    const startedAt = Date.now();
    const callId = `${model.provider}:${model.modelId}:${++callSequence}`;
    const emit = (
      phase: ModelCallPhase,
      details: Partial<ModelCallEvent> = {},
    ) => {
      try {
        options.onEvent({
          callId,
          phase,
          operation,
          provider: model.provider,
          modelId: model.modelId,
          elapsedMs: Date.now() - startedAt,
          ...details,
        });
      } catch {
        // Diagnostics must never change model behavior.
      }
    };
    emit("started");
    return emit;
  }

  return {
    ...model,
    async doGenerate(callOptions) {
      const emit = callObserver("generate");
      try {
        const result = await model.doGenerate(callOptions);
        emit("completed");
        return result;
      } catch (error) {
        emit("failed", { error });
        throw error;
      }
    },
    async doStream(callOptions) {
      const emit = callObserver("stream");
      try {
        const result = await model.doStream(callOptions);
        return { ...result, stream: observedStream(result, emit) };
      } catch (error) {
        emit("failed", { error });
        throw error;
      }
    },
  };
}
