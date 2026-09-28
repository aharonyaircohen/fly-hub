/**
 * Unit tests for the Convex-backed chat event stream
 * (src/dashboard/lib/chat-events-store.ts) and the shared reader
 * (src/dashboard/lib/chat-events-reader.ts): append/since wiring under the
 * global tenant and the JSONL "lines" shape the event routes still speak.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  appendChatEvents,
  readChatEvents,
  CHAT_EVENTS_TENANT,
} from "@dashboard/lib/chat-events-store";
import { readEventsFile } from "@dashboard/lib/chat-events-reader";
import type { Octokit } from "@octokit/rest";

const EVENT = {
  event: "chat.message",
  payload: { role: "assistant", content: "hi" },
  runId: "run-1",
  emittedAt: "2026-07-15T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("appendChatEvents", () => {
  it("appends each event under the global tenant", async () => {
    convex.mutation.mockResolvedValue("id");

    await appendChatEvents("s1", [
      EVENT,
      { ...EVENT, event: "chat.done" },
    ]);

    expect(convex.mutation).toHaveBeenCalledTimes(2);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("chatEvents:append");
    expect(args).toEqual({
      tenantId: CHAT_EVENTS_TENANT,
      sessionId: "s1",
      event: EVENT,
    });
    expect(convex.mutation.mock.calls[1]![1].event.event).toBe("chat.done");
  });
});

describe("readChatEvents", () => {
  it("reads events after a sequence watermark", async () => {
    convex.query.mockResolvedValue([
      { seq: 3, event: EVENT },
      { seq: 4, event: { ...EVENT, event: "chat.done" } },
    ]);

    const result = await readChatEvents("s1", 2);

    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("chatEvents:since");
    expect(args).toEqual({
      tenantId: CHAT_EVENTS_TENANT,
      sessionId: "s1",
      afterSeq: 2,
    });
    expect(result.events).toHaveLength(2);
    expect(result.lastSeq).toBe(4);
  });

  it("defaults to reading from the start and keeps the watermark on empty", async () => {
    convex.query.mockResolvedValue([]);

    const result = await readChatEvents("s1");

    expect(convex.query.mock.calls[0]![1].afterSeq).toBe(-1);
    expect(result).toEqual({ events: [], lastSeq: -1 });
  });
});

describe("readEventsFile (route-facing reader)", () => {
  it("returns Convex events as JSONL-style lines", async () => {
    convex.query.mockResolvedValue([{ seq: 0, event: EVENT }]);

    const result = await readEventsFile(
      {} as unknown as Octokit,
      "acme",
      "widgets",
      "main",
      "s1",
    );

    expect(result.exists).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(JSON.parse(result.lines[0]!)).toEqual(EVENT);
  });

  it("reports a missing stream as exists=false", async () => {
    convex.query.mockResolvedValue([]);

    const result = await readEventsFile(
      {} as unknown as Octokit,
      "acme",
      "widgets",
      "main",
      "s-none",
    );

    expect(result).toEqual({ lines: [], exists: false, fromCache: false });
  });
});
