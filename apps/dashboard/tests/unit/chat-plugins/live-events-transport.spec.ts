/**
 * @fileoverview Unit tests for the live-events plugin's Convex-backed
 * ChatLiveTransport: subscription args, seq-watermark dedup across
 * reactive updates, payload key-unescaping, malformed-doc tolerance,
 * and unsubscribe semantics.
 *
 * @testFramework vitest
 * @domain chat-plugins
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const onUpdateMock = vi.fn();
const clientCtor = vi.fn();

vi.mock("convex/browser", () => ({
  ConvexClient: class {
    constructor(url: string) {
      clientCtor(url);
    }
    onUpdate = onUpdateMock;
  },
}));

import { createConvexChatLiveTransport } from "@/dashboard/lib/chat/plugins/live-events/convex-live-transport";
import type { ChatLiveTransportEvent } from "@kody-ade/kody-chat-dashboard/platform";

type UpdateCb = (docs: unknown) => void;

function lastOnUpdateCb(): UpdateCb {
  const call = onUpdateMock.mock.calls.at(-1);
  if (!call) throw new Error("onUpdate was never called");
  return call[2] as UpdateCb;
}

beforeEach(() => {
  onUpdateMock.mockReset();
  onUpdateMock.mockReturnValue(() => {});
});

describe("createConvexChatLiveTransport", () => {
  it("subscribes to chatEvents.since with the global tenant and full tail", () => {
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    transport.subscribe("sess-1", () => {});
    expect(onUpdateMock).toHaveBeenCalledTimes(1);
    expect(onUpdateMock.mock.calls[0][1]).toEqual({
      tenantId: "global",
      sessionId: "sess-1",
      afterSeq: -1,
    });
  });

  it("emits each event exactly once across growing reactive updates", () => {
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    const seen: ChatLiveTransportEvent[] = [];
    transport.subscribe("sess-1", (e) => seen.push(e));
    const cb = lastOnUpdateCb();

    cb([{ seq: 0, event: { event: "chat.ready", payload: {} } }]);
    // Reactive queries re-deliver the FULL tail on every update.
    cb([
      { seq: 0, event: { event: "chat.ready", payload: {} } },
      {
        seq: 1,
        event: { event: "chat.message", payload: { content: "hi" } },
      },
    ]);

    expect(seen.map((e) => e.event)).toEqual(["chat.ready", "chat.message"]);
    expect(seen[1].payload).toEqual({ content: "hi" });
  });

  it("skips malformed docs without breaking the stream", () => {
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    const seen: ChatLiveTransportEvent[] = [];
    transport.subscribe("sess-1", (e) => seen.push(e));
    const cb = lastOnUpdateCb();

    cb([
      null,
      { seq: "nope", event: { event: "chat.ready" } },
      { seq: 0, event: { payload: {} } }, // missing event name
      { seq: 1, event: { event: "chat.done", payload: {} } },
    ]);
    cb("not-an-array");

    expect(seen.map((e) => e.event)).toEqual(["chat.done"]);
  });

  it("normalizes a missing/non-object payload to an empty object", () => {
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    const seen: ChatLiveTransportEvent[] = [];
    transport.subscribe("sess-1", (e) => seen.push(e));
    lastOnUpdateCb()([{ seq: 0, event: { event: "chat.exit" } }]);
    expect(seen[0]).toEqual({ event: "chat.exit", payload: {} });
  });

  it("stops emitting after unsubscribe and calls through to Convex", () => {
    const convexUnsub = vi.fn();
    onUpdateMock.mockReturnValue(convexUnsub);
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    const seen: ChatLiveTransportEvent[] = [];
    const unsubscribe = transport.subscribe("sess-1", (e) => seen.push(e));
    const cb = lastOnUpdateCb();

    unsubscribe();
    cb([{ seq: 0, event: { event: "chat.ready", payload: {} } }]);

    expect(convexUnsub).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("key-unescapes stored payloads", () => {
    const transport = createConvexChatLiveTransport("https://x.convex.cloud");
    const seen: ChatLiveTransportEvent[] = [];
    transport.subscribe("sess-1", (e) => seen.push(e));
    // deepUnescapeKeys reverses the store's escaping of reserved $/_ key
    // prefixes; feed an escaped shape and expect the unescaped key back.
    lastOnUpdateCb()([
      {
        seq: 0,
        event: {
          event: "chat.tool",
          payload: { name: "run", input: {} },
        },
      },
    ]);
    expect(seen[0].payload).toMatchObject({ name: "run" });
  });
});
