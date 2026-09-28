/**
 * Persistence observer for one assistant turn.
 *
 * The turn lifecycle decides when persistence transitions happen. Storage is
 * serialized in the background, so a slow append cannot delay model output.
 */
import type {
  ChatTurnObserver,
  ChatTurnPhase,
} from "../transports/turn-coordinator";

const SETTLED_PHASES: ReadonlySet<ChatTurnPhase> = new Set([
  "completed",
  "failed",
  "cancelled",
  "stalled",
]);

export function createAssistantTurnPersistenceObserver<TMessage>(input: {
  persistPending: () => Promise<void>;
  persistSettled: (message: TMessage) => Promise<void>;
  readSettledMessage: () => TMessage | null;
  onError?: (error: Error) => void;
}): { observer: ChatTurnObserver; flush: () => Promise<void> } {
  let queue: Promise<void> | null = null;
  let started = false;
  let settled = false;

  const enqueue = (operation: () => Promise<void>) => {
    const reportFailure = (error: unknown) => {
      input.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    };
    queue = queue
      ? queue.then(operation).catch(reportFailure)
      : operation().catch(reportFailure);
  };

  const observer: ChatTurnObserver = {
    onPhase: (turn) => {
      if (turn.phase === "connecting" && !started) {
        started = true;
        enqueue(input.persistPending);
        return;
      }
      if (!SETTLED_PHASES.has(turn.phase) || settled) return;
      settled = true;
      const message = input.readSettledMessage();
      if (message) enqueue(() => input.persistSettled(message));
    },
  };

  return { observer, flush: () => queue ?? Promise.resolve() };
}
