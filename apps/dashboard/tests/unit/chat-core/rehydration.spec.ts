/**
 * Behavior tests for the live-session persistence ↔ rehydration
 * mount-order contract (chat/core/rehydration.ts, extracted from the
 * REHYDRATE_RESTORED ordering guards in KodyChat.tsx).
 *
 * The invariants pinned here, derived from the component's comments:
 *  1. Restored-before-live: on first mount the reducer is idle/null; the
 *     persistence decision MUST be "skip-initial" (never "clear"), so the
 *     saved record survives until the rehydrate effect reads it.
 *     Symptom when violated: refresh-during-session loses the session.
 *  2. Duplicate-rehydrate suppression: same scope + restore already
 *     attempted → no rehydrate (would tear down the in-flight SSE/poll).
 *     First evaluation always rehydrates, even for the initial scope.
 *  3. Restore round-trip: a saved record → REHYDRATE_RESTORED → reducer →
 *     persistence decision re-saves an equivalent record (no ping-pong,
 *     no downgrade of sessionId/target/runUrl).
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildRehydrateAction,
  decideLivePersistence,
  shouldRehydrateScope,
} from "@kody-ade/kody-chat-dashboard/core/rehydration";
import {
  initialLiveState,
  liveReducer,
  type LiveSessionState,
} from "@kody-ade/kody-chat-dashboard/core/kody-chat-reducer";
import type { PersistedLiveSession } from "@kody-ade/kody-chat-dashboard/kody-chat-live-session";

const NOW = 1_750_000_000_000;

afterEach(() => {
  vi.restoreAllMocks();
});

const state = (over: Partial<LiveSessionState>): LiveSessionState => ({
  ...initialLiveState,
  ...over,
});

const savedRecord = (
  over: Partial<PersistedLiveSession> = {},
): PersistedLiveSession => ({
  sessionId: "sess-1",
  state: "ready",
  startedAt: NOW - 60_000,
  target: { owner: "eng-o", repo: "eng-r" },
  runUrl: "https://github.com/eng-o/eng-r/actions/runs/1",
  ...over,
});

// ─── Invariant 1: restored-before-live (mount ordering) ─────────────────────

describe("decideLivePersistence — mount-order contract", () => {
  it("first run with the initial idle/null state skips (never clears)", () => {
    // This is THE ordering guard: the persistence effect fires before the
    // rehydrate effect on mount. Clearing here would wipe the saved record
    // before REHYDRATE_RESTORED gets to read it.
    const decision = decideLivePersistence(initialLiveState, false);
    expect(decision).toEqual({ kind: "skip-initial" });
  });

  it("never clears on first observation, whatever the phase", () => {
    for (const phase of ["idle", "ended", "error", "stuck"] as const) {
      const decision = decideLivePersistence(
        state({ phase, sessionId: null }),
        false,
      );
      expect(decision.kind).toBe("skip-initial");
    }
  });

  it("clears only on a genuine transition into a terminal phase", () => {
    for (const phase of ["ended", "error", "stuck"] as const) {
      expect(
        decideLivePersistence(
          state({ phase, sessionId: "s", scopeKey: "vibe-7" }),
          true,
        ),
      ).toEqual({ kind: "clear", scopeKey: "vibe-7" });
    }
    // idle only clears when the session id is really gone.
    expect(
      decideLivePersistence(
        state({ phase: "idle", sessionId: null, scopeKey: "global" }),
        true,
      ),
    ).toEqual({ kind: "clear", scopeKey: "global" });
  });

  it("saves booting/ready states with the persisted-record shape", () => {
    const decision = decideLivePersistence(
      state({
        phase: "booting",
        sessionId: "sess-9",
        scopeKey: "vibe-9",
        bootStartedAt: NOW - 5_000,
        target: { owner: "o", repo: "r" },
        runUrl: "https://x/runs/9",
      }),
      false, // even on first observation, an active session is saved
    );
    expect(decision).toEqual({
      kind: "save",
      scopeKey: "vibe-9",
      record: {
        sessionId: "sess-9",
        state: "booting",
        startedAt: NOW - 5_000,
        target: { owner: "o", repo: "r" },
        runUrl: "https://x/runs/9",
      },
    });
  });

  it("leaves the record alone during an in-flight turn (awaiting)", () => {
    // awaiting is not persisted (only booting/ready are), but it must NOT
    // clear either — the runner is alive.
    expect(
      decideLivePersistence(
        state({ phase: "awaiting", sessionId: "sess-1" }),
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("does not persist a booting phase without a session id", () => {
    const decision = decideLivePersistence(
      state({ phase: "booting", sessionId: null }),
      true,
    );
    expect(decision.kind).not.toBe("save");
  });
});

// ─── Invariant 2: duplicate-rehydrate suppression ────────────────────────────

describe("shouldRehydrateScope — duplicate-rehydrate suppression", () => {
  it("suppresses a re-run for the same scope once restore was attempted", () => {
    expect(shouldRehydrateScope("global", "global", true)).toBe(false);
    expect(shouldRehydrateScope("vibe-5", "vibe-5", true)).toBe(false);
  });

  it("always rehydrates on the very first evaluation (refresh restore)", () => {
    // On mount currentScope already equals the initial 'global' — the
    // attempted flag alone must force the first restore.
    expect(shouldRehydrateScope("global", "global", false)).toBe(true);
  });

  it("rehydrates on any genuine scope change", () => {
    expect(shouldRehydrateScope("vibe-5", "global", true)).toBe(true);
    expect(shouldRehydrateScope("global", "vibe-5", true)).toBe(true);
    expect(shouldRehydrateScope("vibe-6", "vibe-5", true)).toBe(true);
  });
});

// ─── buildRehydrateAction mapping ────────────────────────────────────────────

describe("buildRehydrateAction", () => {
  it("maps a missing record to an idle reset for that scope", () => {
    expect(buildRehydrateAction("vibe-3", null)).toEqual({
      type: "REHYDRATE_IDLE",
      scopeKey: "vibe-3",
    });
  });

  it("restores a booting record with its boot timestamp", () => {
    const saved = savedRecord({ state: "booting", startedAt: NOW - 10_000 });
    expect(buildRehydrateAction("global", saved)).toEqual({
      type: "REHYDRATE_RESTORED",
      scopeKey: "global",
      sessionId: "sess-1",
      phase: "booting",
      bootStartedAt: NOW - 10_000,
      target: { owner: "eng-o", repo: "eng-r" },
      runUrl: "https://github.com/eng-o/eng-r/actions/runs/1",
    });
  });

  it("drops the boot timestamp for a ready record (boot is over)", () => {
    const action = buildRehydrateAction("global", savedRecord());
    expect(action).toMatchObject({
      type: "REHYDRATE_RESTORED",
      phase: "ready",
      bootStartedAt: null,
    });
  });

  it("normalizes absent target/runUrl to null", () => {
    const action = buildRehydrateAction(
      "global",
      savedRecord({ target: undefined, runUrl: undefined }),
    );
    expect(action).toMatchObject({ target: null, runUrl: null });
  });
});

// ─── Invariant 3: restore round-trip through the reducer ────────────────────

describe("restore round-trip (rehydrate → reducer → persist)", () => {
  it("a restored booting session re-persists an equivalent record", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const saved = savedRecord({ state: "booting", startedAt: NOW - 20_000 });

    const restored = liveReducer(
      initialLiveState,
      buildRehydrateAction("vibe-2", saved),
    );
    expect(restored.phase).toBe("booting");
    expect(restored.sessionId).toBe("sess-1");

    const decision = decideLivePersistence(restored, true);
    expect(decision).toEqual({
      kind: "save",
      scopeKey: "vibe-2",
      record: saved, // exact fixpoint: nothing lost, nothing invented
    });
  });

  it("a restored ready session re-persists sessionId/target/runUrl intact", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const saved = savedRecord(); // state: "ready"

    const restored = liveReducer(
      initialLiveState,
      buildRehydrateAction("global", saved),
    );
    expect(restored.phase).toBe("ready");

    const decision = decideLivePersistence(restored, true);
    expect(decision.kind).toBe("save");
    if (decision.kind !== "save") return;
    expect(decision.record).toMatchObject({
      sessionId: saved.sessionId,
      state: "ready",
      target: saved.target,
      runUrl: saved.runUrl,
    });
    // ready has no boot timer — the persisted age restarts at "now".
    expect(decision.record.startedAt).toBe(NOW);
  });

  it("a scope with no record resets to idle and (once mounted) clears storage", () => {
    const reset = liveReducer(
      state({ phase: "ready", sessionId: "old", scopeKey: "vibe-1" }),
      buildRehydrateAction("vibe-2", null),
    );
    expect(reset.phase).toBe("idle");
    expect(reset.sessionId).toBeNull();
    expect(decideLivePersistence(reset, true)).toEqual({
      kind: "clear",
      scopeKey: "vibe-2",
    });
  });
});
