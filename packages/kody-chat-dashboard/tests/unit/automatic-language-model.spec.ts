import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import {
  createAutomaticLanguageModel,
  getTemporaryFailureReason,
  isRateLimitError,
} from "../../src/dashboard/lib/chat/core/automatic-language-model";

function stream(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function model(
  id: string,
  options: {
    generateError?: unknown;
    streamParts?: LanguageModelV3StreamPart[];
    streamError?: unknown;
  } = {},
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: id,
    supportedUrls: {},
    doGenerate: vi.fn(async () => {
      if (options.generateError) throw options.generateError;
      return {
        content: [{ type: "text" as const, text: id }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 1 },
        },
        warnings: [],
      } as unknown as Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;
    }),
    doStream: vi.fn(async () => {
      if (options.streamError) throw options.streamError;
      return { stream: stream(options.streamParts ?? []) };
    }),
  };
}

async function readParts(model: LanguageModelV3) {
  const result = await model.doStream({ prompt: [] });
  const parts: LanguageModelV3StreamPart[] = [];
  const reader = result.stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}

describe("Automatic language model", () => {
  it("recognizes only rate-limit errors", () => {
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError({ statusCode: 401 })).toBe(false);
    expect(isRateLimitError(new Error("provider unavailable"))).toBe(false);
  });

  it("recognizes temporary provider failures and classifies their reason", () => {
    expect(getTemporaryFailureReason({ statusCode: 408 })).toBe("timeout");
    expect(getTemporaryFailureReason({ statusCode: 429 })).toBe("rate_limit");
    expect(getTemporaryFailureReason({ statusCode: 503 })).toBe("server_error");
    expect(getTemporaryFailureReason(new Error("fetch failed"))).toBe(
      "network",
    );
    expect(getTemporaryFailureReason({ statusCode: 401 })).toBeNull();
  });

  it("falls back in order when generation is rate limited", async () => {
    const onFallback = vi.fn();
    const automatic = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", { generateError: { statusCode: 429 } }),
        },
        { id: "second", model: model("second") },
      ],
      { onFallback },
    );

    const result = await automatic.doGenerate({ prompt: [] });
    expect(result.content).toEqual([{ type: "text", text: "second" }]);
    expect(onFallback).toHaveBeenCalledWith({
      from: "first",
      to: "second",
      reason: "rate_limit",
    });
  });

  it("falls back in order when generation has a temporary server error", async () => {
    const onFallback = vi.fn();
    const automatic = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", { generateError: { statusCode: 503 } }),
        },
        { id: "second", model: model("second") },
      ],
      { onFallback },
    );

    await expect(automatic.doGenerate({ prompt: [] })).resolves.toMatchObject({
      content: [{ type: "text", text: "second" }],
    });
    expect(onFallback).toHaveBeenCalledWith({
      from: "first",
      to: "second",
      reason: "server_error",
    });
  });

  it("moves to the next configured model when a planning candidate is slow", async () => {
    vi.useFakeTimers();
    const slow = model("slow");
    vi.mocked(slow.doGenerate).mockImplementation(
      ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const onFallback = vi.fn();
    const automatic = createAutomaticLanguageModel(
      [
        { id: "slow", model: slow },
        { id: "fast", model: model("fast") },
      ],
      { onFallback, candidateTimeoutMs: 100 },
    );

    const resultPromise = automatic.doGenerate({ prompt: [] });
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toMatchObject({
      content: [{ type: "text", text: "fast" }],
    });
    expect(onFallback).toHaveBeenCalledWith({
      from: "slow",
      to: "fast",
      reason: "timeout",
    });
    vi.useRealTimers();
  });

  it("falls back when a stream reports rate limiting before model output", async () => {
    const onFallback = vi.fn();
    const automatic = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", {
            streamParts: [
              { type: "stream-start", warnings: [] },
              { type: "error", error: { statusCode: 429 } },
            ],
          }),
        },
        {
          id: "second",
          model: model("second", {
            streamParts: [
              { type: "text-start", id: "text" },
              { type: "text-delta", id: "text", delta: "ok" },
              { type: "text-end", id: "text" },
            ],
          }),
        },
      ],
      { onFallback },
    );

    expect(await readParts(automatic)).toEqual([
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "ok" },
      { type: "text-end", id: "text" },
    ]);
    expect(onFallback).toHaveBeenCalledWith({
      from: "first",
      to: "second",
      reason: "rate_limit",
    });
  });

  it("falls back when the stream has a network failure before output", async () => {
    const onFallback = vi.fn();
    const automatic = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", { streamError: new Error("fetch failed") }),
        },
        { id: "second", model: model("second") },
      ],
      { onFallback },
    );

    await expect(readParts(automatic)).resolves.toEqual([]);
    expect(onFallback).toHaveBeenCalledWith({
      from: "first",
      to: "second",
      reason: "network",
    });
  });

  it("does not fallback for authentication errors or after output begins", async () => {
    const authFallback = vi.fn();
    const authModel = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", { streamError: { statusCode: 401 } }),
        },
        { id: "second", model: model("second") },
      ],
      { onFallback: authFallback },
    );
    await expect(authModel.doStream({ prompt: [] })).rejects.toEqual({
      statusCode: 401,
    });
    expect(authFallback).not.toHaveBeenCalled();

    const lateFallback = vi.fn();
    const lateModel = createAutomaticLanguageModel(
      [
        {
          id: "first",
          model: model("first", {
            streamParts: [
              { type: "text-start", id: "text" },
              { type: "text-delta", id: "text", delta: "started" },
              { type: "error", error: { statusCode: 429 } },
            ],
          }),
        },
        { id: "second", model: model("second") },
      ],
      { onFallback: lateFallback },
    );
    expect(await readParts(lateModel)).toContainEqual({
      type: "error",
      error: { statusCode: 429 },
    });
    expect(lateFallback).not.toHaveBeenCalled();
  });
});
