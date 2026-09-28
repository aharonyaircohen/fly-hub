import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatTurnProtocolError,
  ChatTurnStalledError,
  runChatTurn,
} from "../../../../src/dashboard/lib/chat/core/transports/turn-coordinator";
import type {
  ChatEvent,
  ChatTransport,
} from "../../../../src/dashboard/lib/chat/core/transports/transport-types";
import { preparedTurnFixture } from "../../../fixtures/prepared-turn";

const INPUT = {
  preparedTurn: preparedTurnFixture,
  sessionId: "session-1",
  text: "hello",
  agentId: "kody",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("runChatTurn", () => {
  it("owns the turn lifecycle from connecting through completion", async () => {
    const events: ChatEvent[] = [];
    const phases: string[] = [];
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        ctx.emit({ type: "token", text: "hello" });
        ctx.emit({ type: "done" });
      },
    };

    const result = await runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: (event) => events.push(event) },
      inactivityMs: 1_000,
      onPhaseChange: (turn) => phases.push(turn.phase),
    });

    expect(result.phase).toBe("completed");
    expect(result.turnId).toBeTruthy();
    expect(events).toEqual([
      { type: "token", text: "hello" },
      { type: "done" },
    ]);
    expect(phases).toEqual(["connecting", "active", "completed"]);
  });

  it("publishes lifecycle and transport events through one observer boundary", async () => {
    const observed: string[] = [];
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        ctx.emit({ type: "token", text: "hello" });
        ctx.emit({ type: "done" });
      },
    };

    await runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: () => {} },
      inactivityMs: 1_000,
      observer: {
        onPhase: (turn) => observed.push(`phase:${turn.phase}`),
        onEvent: (event) => observed.push(`event:${event.type}`),
      },
    });

    expect(observed).toEqual([
      "phase:connecting",
      "phase:active",
      "event:token",
      "event:done",
      "phase:completed",
    ]);
  });

  it("settles the surface before observers receive completion", async () => {
    let surfaceSettled = false;
    const completionObservations: boolean[] = [];
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        ctx.emit({ type: "done" });
      },
    };

    await runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: () => {} },
      inactivityMs: 1_000,
      settle: () => {
        surfaceSettled = true;
      },
      observer: {
        onPhase: (snapshot) => {
          if (snapshot.phase === "completed") {
            completionObservations.push(surfaceSettled);
          }
        },
      },
    });

    expect(completionObservations).toEqual([true]);
  });

  it("uses a caller-provided turn id for end-to-end correlation", async () => {
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        ctx.emit({ type: "done" });
      },
    };

    await expect(
      runChatTurn({
        transport,
        input: INPUT,
        context: { authHeaders: {}, emit: () => {} },
        inactivityMs: 1_000,
        turnId: "turn-123",
      }),
    ).resolves.toMatchObject({ turnId: "turn-123" });
  });

  it("treats a non-recoverable transport error as a terminal failed turn", async () => {
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        ctx.emit({
          type: "error",
          message: "provider failed",
          recoverable: false,
        });
        ctx.emit({ type: "token", text: "ignored after failure" });
      },
    };
    const events: ChatEvent[] = [];

    const result = await runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: (event) => events.push(event) },
      inactivityMs: 1_000,
    });

    expect(result.phase).toBe("failed");
    expect(events).toEqual([
      { type: "error", message: "provider failed", recoverable: false },
    ]);
  });

  it("rejects invalid inactivity limits before starting the transport", async () => {
    const send = vi.fn();

    await expect(
      runChatTurn({
        transport: { id: "test", send },
        input: INPUT,
        context: { authHeaders: {}, emit: () => {} },
        inactivityMs: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("stalls an inactive transport and aborts its work", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        transportSignal = ctx.signal;
        await new Promise<void>(() => {});
      },
    };

    const turn = runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: () => {} },
      inactivityMs: 5_000,
    });
    const stalled = expect(turn).rejects.toBeInstanceOf(ChatTurnStalledError);
    await vi.advanceTimersByTimeAsync(5_000);

    await stalled;
    expect(transportSignal?.aborted).toBe(true);
  });

  it("resets the inactivity deadline whenever transport activity arrives", async () => {
    vi.useFakeTimers();
    let emit!: (event: ChatEvent) => void;
    let finish!: () => void;
    const transport: ChatTransport = {
      id: "test",
      async send(_input, ctx) {
        emit = ctx.emit;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    };

    const turn = runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, emit: () => {} },
      inactivityMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(4_000);
    emit({ type: "token", text: "still working" });
    await vi.advanceTimersByTimeAsync(4_000);
    emit({ type: "done" });
    finish();

    await expect(turn).resolves.toMatchObject({ phase: "completed" });
  });

  it("preserves user cancellation as an AbortError", async () => {
    const abort = new AbortController();
    const transport: ChatTransport = {
      id: "test",
      async send() {
        await new Promise<void>(() => {});
      },
    };

    const turn = runChatTurn({
      transport,
      input: INPUT,
      context: { authHeaders: {}, signal: abort.signal, emit: () => {} },
      inactivityMs: 5_000,
    });
    abort.abort();

    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a transport that resolves without a terminal event", async () => {
    const transport: ChatTransport = { id: "test", async send() {} };

    await expect(
      runChatTurn({
        transport,
        input: INPUT,
        context: { authHeaders: {}, emit: () => {} },
        inactivityMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(ChatTurnProtocolError);
  });

  it("marks a thrown transport failure before returning the error", async () => {
    const phases: string[] = [];
    const transport: ChatTransport = {
      id: "test",
      async send() {
        throw new Error("network failed");
      },
    };

    await expect(
      runChatTurn({
        transport,
        input: INPUT,
        context: { authHeaders: {}, emit: () => {} },
        inactivityMs: 1_000,
        onPhaseChange: (turn) => phases.push(turn.phase),
      }),
    ).rejects.toThrow("network failed");
    expect(phases).toEqual(["connecting", "failed"]);
  });
});
