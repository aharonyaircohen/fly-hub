import { describe, expect, it, vi } from "vitest";
import { consumeHermesStream } from "@kody-ade/kody-chat-dashboard/core/transports/hermes-stream";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("Hermes chat event stream", () => {
  it("parses event names and JSON split across network chunks", async () => {
    const onEvent = vi.fn();
    await consumeHermesStream(streamOf([
      "event: assistant.delta\ndata: {\"delta\":\"hel",
      "lo\"}\n\nevent: assistant.completed\ndata: {\"content\":\"hello\"}\n\n",
    ]), onEvent);

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "assistant.delta", payload: { delta: "hello" } },
      { type: "assistant.completed", payload: { content: "hello" } },
    ]);
  });

  it("ignores keepalive frames", async () => {
    const onEvent = vi.fn();
    await consumeHermesStream(streamOf([
      ": keepalive\n\n",
      "event: run.completed\ndata: {\"status\":\"completed\"}\n\n",
    ]), onEvent);

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toEqual({
      type: "run.completed",
      payload: { status: "completed" },
    });
  });
});
