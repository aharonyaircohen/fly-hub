/**
 * @fileType module
 * @domain chat-platform
 * @pattern turn-lifecycle-coordinator
 * @ai-summary Owns one chat turn from transport start to a terminal event.
 *   Transports translate protocols into ChatEvents; this coordinator owns
 *   lifecycle state, cancellation, inactivity detection, and the invariant
 *   that a resolved transport must emit `done` or a terminal error.
 */

import type {
  ChatEvent,
  ChatTransport,
  ChatTransportContext,
  ChatTurnInput,
} from "./transport-types";

export type ChatTurnPhase =
  "connecting" | "active" | "completed" | "failed" | "cancelled" | "stalled";

export interface ChatTurnSnapshot {
  turnId: string;
  sessionId: string;
  transportId: string;
  phase: ChatTurnPhase;
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;
}

export interface ChatTurnObserver {
  onPhase?: (turn: ChatTurnSnapshot) => void;
  onEvent?: (event: ChatEvent, turn: ChatTurnSnapshot) => void;
}

export class ChatTurnStalledError extends Error {
  constructor(inactivityMs: number) {
    super(
      `Reply stalled after ${Math.ceil(inactivityMs / 1_000)} seconds without activity. Please retry.`,
    );
    this.name = "ChatTurnStalledError";
  }
}

export class ChatTurnProtocolError extends Error {
  constructor(transportId: string) {
    super(
      `Chat transport "${transportId}" ended without a done or terminal error event.`,
    );
    this.name = "ChatTurnProtocolError";
  }
}

export interface RunChatTurnOptions {
  transport: ChatTransport;
  input: ChatTurnInput;
  context: ChatTransportContext;
  inactivityMs: number;
  turnId?: string;
  onPhaseChange?: (turn: ChatTurnSnapshot) => void;
  observer?: ChatTurnObserver;
  /** Finalize the user-visible turn before completion observers run. */
  settle?: (turn: ChatTurnSnapshot) => void | Promise<void>;
}

function createTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function isTerminal(phase: ChatTurnPhase): boolean {
  return (
    phase === "completed" ||
    phase === "failed" ||
    phase === "cancelled" ||
    phase === "stalled"
  );
}

/** Run one transport under the shared lifecycle and inactivity contract. */
export async function runChatTurn(
  options: RunChatTurnOptions,
): Promise<ChatTurnSnapshot> {
  const { transport, input, context, inactivityMs, onPhaseChange, observer } =
    options;
  if (!Number.isFinite(inactivityMs) || inactivityMs <= 0) {
    throw new RangeError("inactivityMs must be a positive finite number");
  }

  const startedAt = Date.now();
  const turnId = options.turnId ?? input.turnId ?? createTurnId();
  let turn: ChatTurnSnapshot = {
    turnId,
    sessionId: input.sessionId,
    transportId: transport.id,
    phase: "connecting",
    startedAt,
    lastActivityAt: startedAt,
  };
  const publish = (phase: ChatTurnPhase) => {
    const now = Date.now();
    turn = {
      ...turn,
      phase,
      ...(isTerminal(phase) ? { endedAt: now } : {}),
    };
    onPhaseChange?.({ ...turn });
    observer?.onPhase?.({ ...turn });
  };
  onPhaseChange?.({ ...turn });
  observer?.onPhase?.({ ...turn });

  const controller = new AbortController();
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let completionRequested = false;
  let rejectLifecycle!: (reason: unknown) => void;
  const lifecycleFailure = new Promise<never>((_resolve, reject) => {
    rejectLifecycle = reject;
  });

  const armInactivityDeadline = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (isTerminal(turn.phase)) return;
      const error = new ChatTurnStalledError(inactivityMs);
      publish("stalled");
      rejectLifecycle(error);
      controller.abort(error);
    }, inactivityMs);
  };

  const handleExternalAbort = () => {
    if (isTerminal(turn.phase)) return;
    const error = abortError();
    publish("cancelled");
    rejectLifecycle(error);
    controller.abort(context.signal?.reason);
  };
  if (context.signal?.aborted) handleExternalAbort();
  else
    context.signal?.addEventListener("abort", handleExternalAbort, {
      once: true,
    });

  const emit = (event: ChatEvent) => {
    if (isTerminal(turn.phase)) return;
    turn = { ...turn, lastActivityAt: Date.now() };
    if (turn.phase === "connecting") publish("active");
    armInactivityDeadline();
    context.emit(event);
    observer?.onEvent?.(event, { ...turn });
    if (event.type === "done") completionRequested = true;
    else if (event.type === "error" && !event.recoverable) publish("failed");
  };

  armInactivityDeadline();
  const transportRun = transport
    .send(
      { ...input, turnId },
      {
        authHeaders: context.authHeaders,
        signal: controller.signal,
        emit,
      },
    )
    .then(async () => {
      if (completionRequested) {
        await options.settle?.({ ...turn });
        publish("completed");
      } else if (turn.phase !== "failed") {
        throw new ChatTurnProtocolError(transport.id);
      }
      return { ...turn };
    })
    .catch((error: unknown) => {
      if (!isTerminal(turn.phase)) publish("failed");
      throw error;
    });

  try {
    return await Promise.race([transportRun, lifecycleFailure]);
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    context.signal?.removeEventListener("abort", handleExternalAbort);
  }
}
