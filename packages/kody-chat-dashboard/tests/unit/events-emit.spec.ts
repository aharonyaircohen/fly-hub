/**
 * Unit tests for the system-event emitter and sink registry
 * (src/dashboard/lib/events/emit.ts, sink-registry.ts): envelope shape,
 * invalid-payload drop, sink fan-out, and sink failure isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@kody-ade/base/logger", () => ({ logger: h.logger }));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: vi.fn().mockResolvedValue(null),
}));
vi.mock("@kody-ade/base/github/core", () => ({
  createUserOctokit: vi.fn(),
}));

import {
  emitSystemEvent,
  setEventFlushScheduler,
  _resetDefaultSinkRegistration,
} from "@kody-ade/base/events/emit";
import {
  registerSystemEventSink,
  _resetSystemEventSinks,
} from "@kody-ade/base/events/sink-registry";
import type { SystemEventEnvelope } from "@kody-ade/base/events/types";

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSystemEventSinks();
  // Keep default sinks out of the way: mark them registered without adding.
  _resetDefaultSinkRegistration();
});

function captureSink(name = "capture") {
  const received: SystemEventEnvelope[] = [];
  registerSystemEventSink({
    name,
    async handle(events) {
      received.push(...events);
    },
  });
  return received;
}

describe("emitSystemEvent", () => {
  it("wraps the payload in a full envelope", async () => {
    const received = captureSink();
    emitSystemEvent(
      "page.viewed",
      { path: "/models" },
      {
        userId: "operator:aguy",
        sessionId: "s-9",
        brand: { owner: "acme", repo: "shop" },
        source: "client",
      },
    );
    await flushAsync();

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.name).toBe("page.viewed");
    expect(event.version).toBe(1);
    expect(event.userId).toBe("operator:aguy");
    expect(event.sessionId).toBe("s-9");
    expect(event.brand).toEqual({ owner: "acme", repo: "shop" });
    expect(event.source).toBe("client");
    expect(event.payload).toEqual({ path: "/models" });
    expect(event.id.length).toBeGreaterThan(8);
    expect(new Date(event.occurredAt).getTime()).not.toBeNaN();
  });

  it("routes dispatch through an installed flush scheduler", async () => {
    const received = captureSink();
    const tasks: Array<() => void | Promise<void>> = [];
    setEventFlushScheduler((task) => {
      tasks.push(task);
    });
    try {
      emitSystemEvent("page.viewed", { path: "/x" }, { source: "server" });
      expect(received).toHaveLength(0);
      for (const task of tasks) await task();
      expect(received).toHaveLength(1);
    } finally {
      // Restore the framework-free default for the rest of the suite.
      setEventFlushScheduler((task) => {
        queueMicrotask(() => {
          void Promise.resolve()
            .then(task)
            .catch(() => {});
        });
      });
    }
  });

  it("drops invalid payloads with a warning and never throws", async () => {
    const received = captureSink();
    expect(() =>
      emitSystemEvent(
        "page.viewed",
        // Missing required `path`.
        {} as never,
        { source: "server" },
      ),
    ).not.toThrow();
    await flushAsync();

    expect(received).toHaveLength(0);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "page.viewed" }),
      expect.stringContaining("invalid payload"),
    );
  });

  it("fans out to every sink and isolates a throwing sink", async () => {
    registerSystemEventSink({
      name: "broken",
      async handle() {
        throw new Error("sink exploded");
      },
    });
    const received = captureSink("healthy");

    emitSystemEvent(
      "session.ended",
      { sessionId: "s-1" },
      { source: "server" },
    );
    await flushAsync();

    expect(received).toHaveLength(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sink: "broken" }),
      expect.stringContaining("sink failed"),
    );
  });

  it("registers a sink only once per name", async () => {
    const received = captureSink("dupe");
    registerSystemEventSink({
      name: "dupe",
      async handle(events) {
        received.push(...events);
      },
    });

    emitSystemEvent(
      "session.started",
      { sessionId: "s-2" },
      { source: "server" },
    );
    await flushAsync();

    expect(received).toHaveLength(1);
  });
});
