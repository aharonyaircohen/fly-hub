import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import { observeLanguageModelCalls } from "../../src/dashboard/lib/chat/core/model-call-observer";

function stream(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function testModel(options: { streamError?: unknown } = {}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test-provider",
    modelId: "test-model",
    supportedUrls: {},
    doGenerate: vi.fn(async () =>
      ({
        content: [{ type: "text" as const, text: "ok" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 1 },
        },
        warnings: [],
      }) as unknown as Awaited<ReturnType<LanguageModelV3["doGenerate"]>>,
    ),
    doStream: vi.fn(async () => {
      if (options.streamError) throw options.streamError;
      return {
        stream: stream([
          { type: "response-metadata", id: "provider-request-1" },
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "ok" },
          { type: "text-end", id: "text" },
        ]),
      };
    }),
  };
}

async function consumeStream(model: LanguageModelV3) {
  const result = await model.doStream({ prompt: [] });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {
    // Consume the provider stream so completion can be observed.
  }
}

describe("model call observer", () => {
  it("reports a streamed call from start through first response and completion", async () => {
    const onEvent = vi.fn();
    const observed = observeLanguageModelCalls(testModel(), { onEvent });

    await consumeStream(observed);

    expect(onEvent.mock.calls.map(([event]) => event.phase)).toEqual([
      "started",
      "first_response",
      "completed",
    ]);
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      operation: "stream",
      provider: "test-provider",
      modelId: "test-model",
      providerRequestId: "provider-request-1",
    });
  });

  it("reports provider failures without changing the thrown error", async () => {
    const failure = new Error("provider unavailable");
    const onEvent = vi.fn();
    const observed = observeLanguageModelCalls(testModel({ streamError: failure }), {
      onEvent,
    });

    await expect(observed.doStream({ prompt: [] })).rejects.toBe(failure);
    expect(onEvent.mock.calls.map(([event]) => event.phase)).toEqual([
      "started",
      "failed",
    ]);
    expect(onEvent.mock.calls[1]?.[0].error).toBe(failure);
  });

  it("reports non-streaming generation completion", async () => {
    const onEvent = vi.fn();
    const observed = observeLanguageModelCalls(testModel(), { onEvent });

    await observed.doGenerate({ prompt: [] });

    expect(onEvent.mock.calls.map(([event]) => event.phase)).toEqual([
      "started",
      "completed",
    ]);
    expect(onEvent.mock.calls[1]?.[0].operation).toBe("generate");
  });
});
