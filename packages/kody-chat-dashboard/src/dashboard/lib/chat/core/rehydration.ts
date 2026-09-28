/**
 * @fileType logic
 * @domain kody
 * @pattern live-session-rehydration
 * @ai-summary Pure decision logic for the live-session persistence ↔
 *   rehydration mount-order contract (extracted from KodyChat.tsx). Three
 *   decisions, no React, no storage I/O:
 *   1. decideLivePersistence — what the persistence effect should do for a
 *      given reducer state (save / leave-initial-record-alone / clear /
 *      nothing). Encodes the "restored-before-live" guard: on first mount
 *      the reducer is idle/null and the persisted record MUST NOT be
 *      cleared before the rehydrate effect reads it.
 *   2. shouldRehydrateScope — whether a scope change (or first mount)
 *      warrants a rehydrate. Encodes duplicate-rehydrate suppression.
 *   3. buildRehydrateAction — the reducer action a saved record maps to
 *      (REHYDRATE_RESTORED) or the idle reset when nothing was saved.
 */

import type {
  LiveAction,
  LiveScopeKey,
  LiveSessionState,
} from "./kody-chat-reducer";

export interface PersistedLiveSession {
  sessionId: string;
  state: "booting" | "ready";
  startedAt: number;
  target?: { owner: string; repo: string };
  runUrl?: string;
}

/** What the persistence effect should do for the current reducer state. */
export type LivePersistenceDecision =
  | {
      /** Active session — write (or refresh) the persisted record. */
      kind: "save";
      scopeKey: LiveScopeKey;
      record: PersistedLiveSession;
    }
  | {
      /**
       * First run with the initial idle/null state — leave any persisted
       * record alone so the rehydrate effect can read it. Clearing here
       * is the historical bug: refresh-during-session lost the session.
       */
      kind: "skip-initial";
    }
  | {
      /** Genuine transition out of an active session — drop the record. */
      kind: "clear";
      scopeKey: LiveScopeKey;
    }
  | {
      /** Transient in-session phase (e.g. awaiting) — record stays as-is. */
      kind: "none";
    };

/**
 * Decide persistence for a reducer state. `hasObservedState` mirrors the
 * component's `persistenceMountedRef`: false only until the effect has run
 * once (callers must mark it true after acting on "save" or "skip-initial").
 *
 * Mount-order contract (restored-before-live): with `hasObservedState ===
 * false` the decision is NEVER "clear" — the initial idle/null render must
 * not wipe the saved record before REHYDRATE_RESTORED gets to read it.
 */
export function decideLivePersistence(
  state: Pick<
    LiveSessionState,
    "phase" | "sessionId" | "scopeKey" | "bootStartedAt" | "target" | "runUrl"
  >,
  hasObservedState: boolean,
): LivePersistenceDecision {
  const { phase, sessionId, scopeKey, bootStartedAt, target, runUrl } = state;
  if ((phase === "booting" || phase === "ready") && sessionId) {
    return {
      kind: "save",
      scopeKey,
      record: {
        sessionId,
        state: phase,
        startedAt: bootStartedAt ?? Date.now(),
        target: target ?? undefined,
        runUrl: runUrl ?? undefined,
      },
    };
  }
  if (!hasObservedState) {
    return { kind: "skip-initial" };
  }
  if (
    phase === "ended" ||
    phase === "error" ||
    phase === "stuck" ||
    (phase === "idle" && !sessionId)
  ) {
    return { kind: "clear", scopeKey };
  }
  return { kind: "none" };
}

/**
 * Whether the scope-tracking effect should run a rehydrate. True on the
 * very first evaluation (`restoreAttempted === false`, the refresh-restore
 * path) and on any genuine scope change; false when the scope is unchanged
 * and a restore has already been attempted — re-running would tear down the
 * in-flight SSE/poll and re-dispatch REHYDRATE for no reason
 * (duplicate-rehydrate suppression).
 */
export function shouldRehydrateScope(
  nextScope: LiveScopeKey,
  currentScope: LiveScopeKey,
  restoreAttempted: boolean,
): boolean {
  return !(nextScope === currentScope && restoreAttempted);
}

/**
 * Map a loaded record (or its absence) to the reducer action a scope swap
 * dispatches. No record → reset to idle for that scope. Saved record →
 * REHYDRATE_RESTORED with `bootStartedAt` carried over ONLY while still
 * booting (a ready session's boot timer is over; restoring it would
 * resurrect the boot countdown/watchdog against a stale timestamp).
 */
export function buildRehydrateAction(
  scopeKey: LiveScopeKey,
  saved: PersistedLiveSession | null,
): LiveAction {
  if (!saved) {
    return { type: "REHYDRATE_IDLE", scopeKey };
  }
  return {
    type: "REHYDRATE_RESTORED",
    scopeKey,
    sessionId: saved.sessionId,
    phase: saved.state,
    bootStartedAt: saved.state === "booting" ? saved.startedAt : null,
    target: saved.target ?? null,
    runUrl: saved.runUrl ?? null,
  };
}
