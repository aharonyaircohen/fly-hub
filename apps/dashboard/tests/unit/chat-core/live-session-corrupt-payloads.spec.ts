/**
 * Corrupt-payload hardening tests (phase-1 M5.1) for the six former
 * `JSON.parse(raw) as X` casts in chat/core/kody-chat-live-session.ts,
 * now zod-validated via chat/core/live-session-schemas.ts.
 *
 * Contract for every site: a corrupt/mistyped payload behaves like an
 * ABSENT payload (the same fallback the surrounding code always had) —
 * never a throw, never a crash.
 *
 * Sites covered:
 *  1. isBrainChatPinned      — kody-brain-chat-ids map
 *  2. stickyBrainChatId      — kody-brain-chat-ids map
 *  3. liveSessionStorageKey  — kody_auth {owner, repo}
 *  4. readAllLiveSessions    — scoped kody-live-sessions map
 *  5. legacy kody-live-session single-record migration
 *  6. unscoped kody-live-sessions map adoption
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  isBrainChatPinned,
  stickyBrainChatId,
  loadLiveSession,
  saveLiveSession,
  type PersistedLiveSession,
} from "@kody-ade/kody-chat-dashboard/kody-chat-live-session";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

function installStorage(auth?: object): MemStorage {
  const store = new MemStorage();
  if (auth) store.setItem("kody_auth", JSON.stringify(auth));
  (globalThis as { window?: unknown }).window = { localStorage: store };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  return store;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const AUTH = { owner: "test-owner", repo: "test-repo", token: "t" };
const SCOPED_KEY = "kody-live-sessions:test-owner/test-repo";
const UNSCOPED_KEY = "kody-live-sessions";
const LEGACY_KEY = "kody-live-session";
const BRAIN_KEY = "kody-brain-chat-ids";

const rec = (
  over: Partial<PersistedLiveSession> = {},
): PersistedLiveSession => ({
  sessionId: "sess-1",
  state: "ready",
  startedAt: Date.now(),
  ...over,
});

// ─── Site 1: isBrainChatPinned ───────────────────────────────────────────────

describe("isBrainChatPinned — corrupt kody-brain-chat-ids", () => {
  it("truncated JSON → not pinned (no throw)", () => {
    const store = installStorage();
    store.setItem(BRAIN_KEY, '{"conv-1":"pin');
    expect(() => isBrainChatPinned("conv-1")).not.toThrow();
    expect(isBrainChatPinned("conv-1")).toBe(false);
  });

  it("valid JSON of the wrong shape (array / scalar) → not pinned", () => {
    const store = installStorage();
    store.setItem(BRAIN_KEY, "[1,2,3]");
    expect(isBrainChatPinned("conv-1")).toBe(false);
    store.setItem(BRAIN_KEY, "42");
    expect(isBrainChatPinned("conv-1")).toBe(false);
  });

  it("non-string value under the key → not pinned; other keys unaffected", () => {
    const store = installStorage();
    store.setItem(BRAIN_KEY, JSON.stringify({ "conv-1": 7, "conv-2": "ok" }));
    expect(isBrainChatPinned("conv-1")).toBe(false);
    expect(isBrainChatPinned("conv-2")).toBe(true);
  });
});

// ─── Site 2: stickyBrainChatId ───────────────────────────────────────────────

describe("stickyBrainChatId — corrupt kody-brain-chat-ids", () => {
  it("truncated JSON → falls back to the candidate (no throw)", () => {
    const store = installStorage();
    store.setItem(BRAIN_KEY, '{"conv-1":"pin');
    expect(() => stickyBrainChatId("conv-1", "cand")).not.toThrow();
    expect(stickyBrainChatId("conv-1", "cand")).toBe("cand");
  });

  it("non-string pinned value → candidate wins, storage left untouched", () => {
    const store = installStorage();
    const blob = JSON.stringify({ "conv-1": 12345 });
    store.setItem(BRAIN_KEY, blob);
    expect(stickyBrainChatId("conv-1", "cand")).toBe("cand");
    expect(store.getItem(BRAIN_KEY)).toBe(blob);
  });

  it("wrong-shape payload → candidate pinned as if the map were empty", () => {
    const store = installStorage();
    store.setItem(BRAIN_KEY, "[]");
    expect(stickyBrainChatId("conv-1", "cand")).toBe("cand");
    // Later turns reuse the pin — the corrupt payload was treated as absent.
    expect(stickyBrainChatId("conv-1", "other")).toBe("cand");
  });
});

// ─── Site 3: liveSessionStorageKey (kody_auth) ───────────────────────────────

describe("liveSessionStorageKey — corrupt kody_auth", () => {
  it("truncated kody_auth JSON → writes under the unscoped key", () => {
    const store = installStorage();
    store.setItem("kody_auth", '{"owner":"o","repo');
    expect(() => saveLiveSession("global", rec())).not.toThrow();
    expect(store.m.has(UNSCOPED_KEY)).toBe(true);
  });

  it("non-string owner/repo → unscoped key (treated as no repo)", () => {
    const store = installStorage();
    store.setItem("kody_auth", JSON.stringify({ owner: 5, repo: "r" }));
    saveLiveSession("global", rec());
    expect(store.m.has(UNSCOPED_KEY)).toBe(true);
  });

  it("empty owner/repo strings → unscoped key", () => {
    const store = installStorage();
    store.setItem("kody_auth", JSON.stringify({ owner: "", repo: "" }));
    saveLiveSession("global", rec());
    expect(store.m.has(UNSCOPED_KEY)).toBe(true);
  });
});

// ─── Site 4: readAllLiveSessions (scoped map) ────────────────────────────────

describe("readAllLiveSessions — corrupt scoped map", () => {
  it("truncated map JSON → every scope reads as absent (no throw)", () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, '{"global":{"sessionId":"x"');
    expect(() => loadLiveSession("global")).not.toThrow();
    expect(loadLiveSession("global")).toBeNull();
  });

  it("wrong-shape map (array) → absent", () => {
    const store = installStorage(AUTH);
    store.setItem(SCOPED_KEY, "[1,2,3]");
    expect(loadLiveSession("global")).toBeNull();
  });

  it("one corrupt entry is dropped without discarding healthy siblings", () => {
    const store = installStorage(AUTH);
    const good = rec({ sessionId: "good" });
    store.setItem(
      SCOPED_KEY,
      JSON.stringify({
        global: good,
        "vibe-1": { sessionId: "bad", state: "weird", startedAt: "nope" },
      }),
    );
    expect(loadLiveSession("vibe-1")).toBeNull();
    expect(loadLiveSession("global")?.sessionId).toBe("good");
    // The prune persists the cleaned map.
    expect(JSON.parse(store.getItem(SCOPED_KEY) as string)).toEqual({
      global: good,
    });
  });

  it("an entry with an invalid state enum is treated as absent", () => {
    const store = installStorage(AUTH);
    store.setItem(
      SCOPED_KEY,
      JSON.stringify({ global: { ...rec(), state: "zombie" } }),
    );
    expect(loadLiveSession("global")).toBeNull();
  });
});

// ─── Site 5: legacy single-record migration ──────────────────────────────────

describe("legacy kody-live-session migration — corrupt record", () => {
  it("truncated legacy JSON → nothing adopted, legacy key still consumed", () => {
    const store = installStorage();
    store.setItem(LEGACY_KEY, '{"sessionId":"legacy"');
    expect(() => loadLiveSession("global")).not.toThrow();
    expect(loadLiveSession("global")).toBeNull();
    expect(store.getItem(LEGACY_KEY)).toBeNull();
  });

  it("schema-invalid legacy record (bad startedAt) → not adopted", () => {
    const store = installStorage();
    store.setItem(
      LEGACY_KEY,
      JSON.stringify({ sessionId: "legacy", state: "ready", startedAt: "x" }),
    );
    expect(loadLiveSession("global")).toBeNull();
    expect(store.getItem(LEGACY_KEY)).toBeNull();
  });

  it("valid legacy record still migrates (control)", () => {
    const store = installStorage();
    store.setItem(LEGACY_KEY, JSON.stringify(rec({ sessionId: "legacy" })));
    expect(loadLiveSession("global")?.sessionId).toBe("legacy");
    expect(store.getItem(LEGACY_KEY)).toBeNull();
  });
});

// ─── Site 6: unscoped map adoption ───────────────────────────────────────────

describe("unscoped kody-live-sessions adoption — corrupt map", () => {
  it("truncated unscoped JSON → not adopted, unscoped key dropped", () => {
    const store = installStorage(AUTH);
    store.setItem(UNSCOPED_KEY, '{"global":{"se');
    expect(() => loadLiveSession("global")).not.toThrow();
    expect(loadLiveSession("global")).toBeNull();
    expect(store.getItem(UNSCOPED_KEY)).toBeNull();
  });

  it("wrong-shape unscoped payload (scalar) → not adopted, key dropped", () => {
    const store = installStorage(AUTH);
    store.setItem(UNSCOPED_KEY, "5");
    expect(loadLiveSession("global")).toBeNull();
    expect(store.getItem(UNSCOPED_KEY)).toBeNull();
  });

  it("valid unscoped map still adopts under the scoped key (control)", () => {
    const store = installStorage(AUTH);
    const good = rec({ sessionId: "adopted" });
    store.setItem(UNSCOPED_KEY, JSON.stringify({ global: good }));
    expect(loadLiveSession("global")?.sessionId).toBe("adopted");
    expect(store.getItem(UNSCOPED_KEY)).toBeNull();
    expect(store.m.has(SCOPED_KEY)).toBe(true);
  });
});
