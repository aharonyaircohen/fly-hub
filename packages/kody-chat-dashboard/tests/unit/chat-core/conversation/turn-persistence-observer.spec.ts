import { describe, expect, it, vi } from "vitest";
import { createAssistantTurnPersistenceObserver } from "../../../../src/dashboard/lib/chat/core/conversation/turn-persistence-observer";
import type { ChatTurnSnapshot } from "../../../../src/dashboard/lib/chat/core/transports/turn-coordinator";

function turn(phase: ChatTurnSnapshot["phase"]): ChatTurnSnapshot {
  return {
    turnId: "turn-1",
    sessionId: "session-1",
    transportId: "kody-direct",
    phase,
    startedAt: 1,
    lastActivityAt: 1,
  };
}

describe("assistant turn persistence observer", () => {
  it("does not block the turn while pending storage is slow", () => {
    const persistPending = vi.fn(() => new Promise<void>(() => {}));
    const persistence = createAssistantTurnPersistenceObserver({
      persistPending,
      persistSettled: vi.fn(),
      readSettledMessage: vi.fn(() => null),
    });

    persistence.observer.onPhase?.(turn("connecting"));

    expect(persistPending).toHaveBeenCalledOnce();
  });

  it("serializes the committed message after the pending record", async () => {
    const order: string[] = [];
    let releasePending!: () => void;
    const persistPending = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePending = () => {
            order.push("pending");
            resolve();
          };
        }),
    );
    const persistSettled = vi.fn(async () => {
      order.push("settled");
    });
    const persistence = createAssistantTurnPersistenceObserver({
      persistPending,
      persistSettled,
      readSettledMessage: () => ({ id: "assistant:turn-1", content: "Done" }),
    });

    persistence.observer.onPhase?.(turn("connecting"));
    persistence.observer.onPhase?.(turn("completed"));
    expect(persistSettled).not.toHaveBeenCalled();

    releasePending();
    await persistence.flush();

    expect(order).toEqual(["pending", "settled"]);
  });

  it("continues to settlement and reports each persistence failure", async () => {
    const onError = vi.fn();
    const persistSettled = vi
      .fn()
      .mockRejectedValue(new Error("settle failed"));
    const persistence = createAssistantTurnPersistenceObserver({
      persistPending: vi.fn().mockRejectedValue(new Error("pending failed")),
      persistSettled,
      readSettledMessage: () => ({ id: "assistant:turn-1", content: "Done" }),
      onError,
    });

    persistence.observer.onPhase?.(turn("connecting"));
    persistence.observer.onPhase?.(turn("completed"));
    await persistence.flush();

    expect(persistSettled).toHaveBeenCalledOnce();
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual([
      "pending failed",
      "settle failed",
    ]);
  });
});
