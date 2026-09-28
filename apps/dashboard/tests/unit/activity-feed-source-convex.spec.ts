/**
 * Unit tests for the Convex-backed Activity Feed source
 * (src/dashboard/lib/activity/feed-source.ts): recent sessions via
 * chatEvents.recentSessions, per-session events via chatEvents.since,
 * flattening to EventLogEntry, 60s list cache, and fail-soft per session.
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
  readFeedEntries,
  _resetFeedSourceCache,
} from "@dashboard/lib/activity/feed-source";

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  _resetFeedSourceCache();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

function mockBackend(
  sessions: string[],
  eventsBySession: Record<string, Array<{ seq: number; event: unknown }>>,
) {
  convex.query.mockImplementation(async (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as never);
    if (name === "chatEvents:recentSessions") return sessions;
    if (name === "chatEvents:since") {
      const { sessionId } = args as { sessionId: string };
      const events = eventsBySession[sessionId];
      if (events instanceof Error) throw events;
      return events ?? [];
    }
    throw new Error(`unexpected query ${name}`);
  });
}

describe("readFeedEntries (convex)", () => {
  it("flattens recent sessions' events into EventLogEntry records", async () => {
    mockBackend(["live-2", "live-1"], {
      "live-2": [
        {
          seq: 0,
          event: {
            event: "run.started",
            runId: "r2",
            payload: { a: 1 },
            emittedAt: "2026-07-15T10:00:00Z",
          },
        },
      ],
      "live-1": [
        { seq: 0, event: { event: "run.finished", runId: "r1" } },
        { seq: 1, event: { noEventField: true } }, // skipped
      ],
    });

    const entries = await readFeedEntries("acme", "widgets", "token");

    expect(entries.map((e) => e.id).sort()).toEqual(["live-1:0", "live-2:0"]);
    const started = entries.find((e) => e.id === "live-2:0")!;
    expect(started).toMatchObject({
      event: "run.started",
      runId: "r2",
      payload: { a: 1 },
      emittedAt: "2026-07-15T10:00:00Z",
    });
    // runId defaults when absent
    expect(entries.find((e) => e.id === "live-1:0")!.runId).toBe("r1");
  });

  it("caches the session list for repeat reads", async () => {
    mockBackend(["s1"], { s1: [] });
    await readFeedEntries("acme", "widgets", "token");
    await readFeedEntries("acme", "widgets", "token");
    const listCalls = convex.query.mock.calls.filter(
      ([ref]) => getFunctionName(ref as never) === "chatEvents:recentSessions",
    );
    expect(listCalls).toHaveLength(1);
  });

  it("one bad session stream doesn't sink the whole feed", async () => {
    convex.query.mockImplementation(async (ref: unknown, args: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "chatEvents:recentSessions") return ["bad", "good"];
      const { sessionId } = args as { sessionId: string };
      if (sessionId === "bad") throw new Error("boom");
      return [{ seq: 0, event: { event: "ok", runId: "r" } }];
    });

    const entries = await readFeedEntries("acme", "widgets", "token");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("good:0");
  });
});
