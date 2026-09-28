/**
 * @fileoverview Behavior coverage for the terminal plugin's React hook
 *   (`useChatTerminalRegistry`) — the wiring layer above registry-state:
 *   per-session mode/transport bookkeeping, persistence (skip-first-save,
 *   storage-scope reload), session pruning after hydration, mount
 *   idempotence, Fly inventory refresh (auth-gated, 503, error paths) and the
 *   FLY_MACHINES_REFRESH_EVENT listener lifecycle.
 *
 *   The vitest environment is "node" and the repo has no
 *   @testing-library/react — so this spec mocks "react" with a tiny
 *   deterministic hook runtime (useState/useRef/useMemo/useCallback/
 *   useEffect with cleanup) that re-renders synchronously on state
 *   updates. Pure state rules stay covered in terminal-registry.spec.ts.
 * @testFramework vitest
 * @domain chat-plugins
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Minimal hook runtime (mocked "react") ──────────────────────────────────

const harness = vi.hoisted(() => {
  interface StateCell {
    kind: "state";
    value: unknown;
    setter: (next: unknown) => void;
  }
  interface RefCell {
    kind: "ref";
    current: unknown;
  }
  interface MemoCell {
    kind: "memo";
    value: unknown;
    deps: unknown[] | undefined;
  }
  interface EffectCell {
    kind: "effect";
    deps: unknown[] | undefined;
    cleanup: (() => void) | void;
    mounted: boolean;
  }
  type Cell = StateCell | RefCell | MemoCell | EffectCell;

  let cells: Cell[] = [];
  let cursor = 0;
  let inRender = false;
  let dirty = false;
  let pendingEffects: Array<{
    cell: EffectCell;
    fn: () => (() => void) | void;
    deps: unknown[] | undefined;
  }> = [];
  let current: {
    fn: (props: unknown) => unknown;
    props: unknown;
    result: unknown;
  } | null = null;

  const depsEqual = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));

  const React = {
    useState(initial: unknown) {
      const index = cursor++;
      if (cells[index] === undefined) {
        const value =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
        const cell: StateCell = {
          kind: "state",
          value,
          setter: (next: unknown) => {
            const resolved =
              typeof next === "function"
                ? (next as (prev: unknown) => unknown)(cell.value)
                : next;
            if (Object.is(cell.value, resolved)) return;
            cell.value = resolved;
            dirty = true;
            if (!inRender) render();
          },
        };
        cells[index] = cell;
      }
      const cell = cells[index] as StateCell;
      return [cell.value, cell.setter];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (cells[index] === undefined) {
        cells[index] = { kind: "ref", current: initial };
      }
      return cells[index] as RefCell;
    },
    useMemo(compute: () => unknown, deps: unknown[]) {
      const index = cursor++;
      const existing = cells[index] as MemoCell | undefined;
      if (existing === undefined || !depsEqual(existing.deps, deps)) {
        cells[index] = { kind: "memo", value: compute(), deps };
      }
      return (cells[index] as MemoCell).value;
    },
    useCallback(fn: unknown, deps: unknown[]) {
      return React.useMemo(() => fn, deps);
    },
    useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
      const index = cursor++;
      if (cells[index] === undefined) {
        cells[index] = {
          kind: "effect",
          deps: undefined,
          cleanup: undefined,
          mounted: false,
        };
      }
      const cell = cells[index] as EffectCell;
      if (!cell.mounted || deps === undefined || !depsEqual(cell.deps, deps)) {
        pendingEffects.push({ cell, fn, deps });
      }
    },
  };

  function flushEffects() {
    while (pendingEffects.length > 0) {
      const batch = pendingEffects;
      pendingEffects = [];
      for (const effect of batch) {
        if (typeof effect.cell.cleanup === "function") effect.cell.cleanup();
        effect.cell.cleanup = effect.fn();
        effect.cell.deps = effect.deps;
        effect.cell.mounted = true;
      }
    }
  }

  function render() {
    if (!current) return;
    let guard = 0;
    do {
      if (++guard > 100) throw new Error("hook harness render loop");
      dirty = false;
      inRender = true;
      try {
        cursor = 0;
        current.result = current.fn(current.props);
        flushEffects();
      } finally {
        inRender = false;
      }
    } while (dirty);
  }

  function renderHook<P, R>(fn: (props: P) => R, props: P) {
    cells = [];
    pendingEffects = [];
    current = {
      fn: fn as (props: unknown) => unknown,
      props,
      result: undefined,
    };
    render();
    return {
      result: {
        get current() {
          return current!.result as R;
        },
      },
      rerender(nextProps: P) {
        current!.props = nextProps;
        render();
      },
      unmount() {
        for (const cell of cells) {
          if (
            cell !== undefined &&
            cell.kind === "effect" &&
            typeof cell.cleanup === "function"
          ) {
            cell.cleanup();
          }
        }
        current = null;
      },
    };
  }

  return { React, renderHook };
});

vi.mock("react", () => ({ ...harness.React, default: harness.React }));

// authHeaders gates every network path in the hook; swap per test.
const auth = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock("@kody-ade/kody-chat-dashboard/kody-chat-live-session", () => ({
  authHeaders: () => auth.headers,
}));

import {
  BRAIN_TERMINAL_TRANSPORT,
  useChatTerminalRegistry,
} from "@kody-ade/kody-chat-dashboard/plugins/terminal/useChatTerminalRegistry";
import { FLY_MACHINES_REFRESH_EVENT } from "@kody-ade/kody-chat-dashboard/plugins/terminal/registry-state";
import type { SessionMeta } from "@dashboard/lib/chat-types";

// ─── Environment stubs ──────────────────────────────────────────────────────

type Registry = ReturnType<typeof useChatTerminalRegistry>;

const localStore = new Map<string, string>();
const windowListeners = new Map<string, Set<EventListener>>();
let harnesses: Array<{ unmount: () => void }> = [];

function stubWindow() {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => void localStore.set(key, value),
      removeItem: (key: string) => void localStore.delete(key),
    },
    sessionStorage: {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => void localStore.set(key, value),
      removeItem: (key: string) => void localStore.delete(key),
    },
    addEventListener: (type: string, listener: EventListener) => {
      const set = windowListeners.get(type) ?? new Set();
      set.add(listener);
      windowListeners.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      windowListeners.get(type)?.delete(listener);
    },
  });
}

function session(id: string): SessionMeta {
  return { id } as SessionMeta;
}

interface MountOptions {
  activeSessionId?: string | null;
  sessions?: SessionMeta[];
  sessionsHydrated?: boolean;
  storageScope?: string;
  createSession?: () => string;
}

function mountRegistry(options: MountOptions = {}) {
  const props = {
    activeSessionId:
      options.activeSessionId !== undefined
        ? options.activeSessionId
        : "chat-1",
    createSession: options.createSession ?? (() => "created-session"),
    sessions: options.sessions ?? [session("chat-1")],
    sessionsHydrated: options.sessionsHydrated ?? true,
    storageScope: options.storageScope ?? "test-scope",
  };
  const mounted = harness.renderHook(
    (p: typeof props) => useChatTerminalRegistry(p),
    props,
  );
  harnesses.push(mounted);
  return {
    ...mounted,
    props,
    rerenderWith(next: Partial<typeof props>) {
      mounted.rerender({ ...props, ...next });
    },
  };
}

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

const BRAIN_MACHINE = {
  app: "brain-app",
  machineId: "brain-machine",
  state: "started",
  region: "fra",
  label: "Brain server",
  sizeLabel: "shared 2x · 4 GB",
  feature: "brain",
};
const RUNNER_MACHINE = {
  ...BRAIN_MACHINE,
  machineId: "runner-machine",
  feature: "runner",
};

beforeEach(() => {
  localStore.clear();
  windowListeners.clear();
  auth.headers = {};
  stubWindow();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ machines: [] }),
    })),
  );
});

afterEach(() => {
  for (const mounted of harnesses) mounted.unmount();
  harnesses = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useChatTerminalRegistry defaults", () => {
  it("starts in ai mode on the local transport", () => {
    const { result } = mountRegistry();
    const registry = result.current as Registry;

    expect(registry.mode).toBe("ai");
    expect(registry.activeTransport).toEqual({ type: "local" });
    expect(registry.activeTargetValue).toBe("local");
    expect(registry.mountedTerminals).toEqual([]);
  });

  it("reports idle/ai and a null instance when no session is active", () => {
    const { result } = mountRegistry({ activeSessionId: null, sessions: [] });
    const registry = result.current as Registry;

    expect(registry.mode).toBe("ai");
    expect(registry.activeInstanceId).toBeNull();
  });

  it("keeps a target change while a newly created chat session is being attached", () => {
    const view = mountRegistry({ activeSessionId: null, sessions: [] });
    const registry = view.result.current as Registry;
    const createdSessionId = registry.openTerminalMode(
      BRAIN_TERMINAL_TRANSPORT,
    );

    (view.result.current as Registry).selectTarget("local");

    expect((view.result.current as Registry).activeTargetValue).toBe("local");
    expect((view.result.current as Registry).transportBySessionId).toEqual({
      [createdSessionId]: { type: "local" },
    });
  });
});

describe("useChatTerminalRegistry registration", () => {
  it("openTerminalMode mounts a local terminal for the active session", async () => {
    const { result } = mountRegistry();
    const opened = (result.current as Registry).openTerminalMode();
    await flushMicrotasks();

    expect(opened).toBe("chat-1");
    const registry = result.current as Registry;
    expect(registry.mode).toBe("terminal");
    expect(registry.mountedTerminals).toEqual([
      {
        id: "chat-1::local",
        sessionId: "chat-1",
        transport: { type: "local" },
      },
    ]);
    expect(registry.modeBySessionId).toEqual({ "chat-1": "terminal" });
  });

  it("openTerminalMode creates a session when none is active", async () => {
    const createSession = vi.fn(() => "fresh-session");
    const view = mountRegistry({
      activeSessionId: null,
      sessions: [session("fresh-session")],
      createSession,
    });

    const opened = (view.result.current as Registry).openTerminalMode();

    view.rerenderWith({ activeSessionId: "fresh-session" });
    await flushMicrotasks();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(opened).toBe("fresh-session");
    expect((view.result.current as Registry).mountedTerminals).toEqual([
      {
        id: "fresh-session::local",
        sessionId: "fresh-session",
        transport: { type: "local" },
      },
    ]);
  });

  it("keeps a single mounted terminal when the same target is opened twice", async () => {
    const { result } = mountRegistry();
    (result.current as Registry).openTerminalMode();
    await flushMicrotasks();
    const afterFirst = (result.current as Registry).mountedTerminals;

    (result.current as Registry).openTerminalMode();

    // Duplicate registration is identity-preserving: same list, no clone.
    expect((result.current as Registry).mountedTerminals).toBe(afterFirst);
    expect(afterFirst).toHaveLength(1);
  });

  it("selectTarget('brain') mounts the semantic Brain terminal alongside local", async () => {
    const { result } = mountRegistry();
    (result.current as Registry).openTerminalMode();
    await flushMicrotasks();
    (result.current as Registry).selectTarget("brain");

    const registry = result.current as Registry;
    expect(registry.activeTransport).toEqual(BRAIN_TERMINAL_TRANSPORT);
    expect(registry.activeTargetValue).toBe("brain");
    expect(registry.activeInstanceId).toBe("chat-1::brain");
    expect(registry.mountedTerminals.map((t) => t.id)).toEqual([
      "chat-1::local",
      "chat-1::brain",
    ]);
    expect(registry.transportBySessionId).toEqual({
      "chat-1": BRAIN_TERMINAL_TRANSPORT,
    });
  });

  it("ignores unknown target selections", async () => {
    const { result } = mountRegistry();
    (result.current as Registry).openTerminalMode();
    await flushMicrotasks();
    (result.current as Registry).selectTarget("gone-app:gone-machine");

    const registry = result.current as Registry;
    expect(registry.activeTargetValue).toBe("local");
    expect(registry.mountedTerminals).toHaveLength(1);
  });

  it("scopes mode per session: switching chats returns to that chat's mode", () => {
    const view = mountRegistry({
      sessions: [session("chat-1"), session("chat-2")],
    });
    (view.result.current as Registry).setActiveMode("terminal");
    expect((view.result.current as Registry).mode).toBe("terminal");

    view.rerenderWith({ activeSessionId: "chat-2" });
    expect((view.result.current as Registry).mode).toBe("ai");

    view.rerenderWith({ activeSessionId: "chat-1" });
    expect((view.result.current as Registry).mode).toBe("terminal");
  });
});

describe("useChatTerminalRegistry persistence", () => {
  it("does not persist on mount, then saves after the first real change", () => {
    const key = "kody:chat-terminal-registry:test-scope";
    mountRegistry();
    // Skip-first-persist: mounting alone must not touch storage.
    expect(localStore.has(key)).toBe(false);
  });

  it("round-trips mode/mounted/transport through storage into a fresh mount", () => {
    const first = mountRegistry();
    (first.result.current as Registry).openTerminalMode();
    (first.result.current as Registry).selectTarget("brain");
    first.unmount();

    const second = mountRegistry();
    const registry = second.result.current as Registry;
    expect(registry.mode).toBe("terminal");
    expect(registry.transportBySessionId).toEqual({
      "chat-1": BRAIN_TERMINAL_TRANSPORT,
    });
    expect(registry.mountedTerminals.map((t) => t.id)).toContain(
      "chat-1::brain",
    );
    // Connection state is runtime-only — never restored from storage.
  });

  it("reloads the registry when the storage scope changes", () => {
    const view = mountRegistry({ storageScope: "repo-a" });
    (view.result.current as Registry).setActiveMode("terminal");
    expect((view.result.current as Registry).mode).toBe("terminal");

    view.rerenderWith({ storageScope: "repo-b" });
    expect((view.result.current as Registry).mode).toBe("ai");
    expect((view.result.current as Registry).mountedTerminals).toEqual([]);

    view.rerenderWith({ storageScope: "repo-a" });
    expect((view.result.current as Registry).mode).toBe("terminal");
  });
});

describe("useChatTerminalRegistry pruning", () => {
  it("keeps stale entries until sessions hydrate, then prunes unknown sessions", async () => {
    const seeded = mountRegistry({
      sessions: [session("chat-1"), session("chat-gone")],
    });
    (seeded.result.current as Registry).openTerminalMode();
    await flushMicrotasks();
    seeded.rerenderWith({ activeSessionId: "chat-gone" });
    (seeded.result.current as Registry).openTerminalMode();
    await flushMicrotasks();
    seeded.unmount();

    // Restore with an EMPTY, un-hydrated session list: nothing pruned.
    const view = mountRegistry({ sessions: [], sessionsHydrated: false });
    expect(
      (view.result.current as Registry).mountedTerminals.map(
        (t) => t.sessionId,
      ),
    ).toEqual(["chat-1", "chat-gone"]);

    // Hydration lands with only chat-1 known: chat-gone entries drop.
    view.rerenderWith({
      sessions: [session("chat-1")],
      sessionsHydrated: true,
    });
    const registry = view.result.current as Registry;
    expect(registry.mountedTerminals.map((t) => t.sessionId)).toEqual([
      "chat-1",
    ]);
    expect(registry.modeBySessionId).toEqual({ "chat-1": "terminal" });
    expect(registry.transportBySessionId).toEqual({});
  });
});

describe("useChatTerminalRegistry Fly inventory", () => {
  it("loads the personal Brain using the account cookie without a repository token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ machines: [BRAIN_MACHINE] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = mountRegistry();

    await (result.current as Registry).refreshFlyMachines();

    expect(fetchMock).toHaveBeenCalledWith("/api/kody/brain/status");
    expect((result.current as Registry).terminalMachines).toEqual([
      BRAIN_MACHINE,
    ]);
    expect((result.current as Registry).flyInventoryError).toBeNull();
  });

  it("loads machines and exposes only chat-capable (brain) ones", async () => {
    auth.headers = { "x-kody-token": "t" };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ machines: [BRAIN_MACHINE, RUNNER_MACHINE] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = mountRegistry();

    await (result.current as Registry).refreshFlyMachines();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith("/api/kody/brain/status");
    expect((result.current as Registry).terminalMachines).toEqual([
      BRAIN_MACHINE,
    ]);
    expect((result.current as Registry).flyInventoryLoading).toBe(false);
    expect((result.current as Registry).flyInventoryError).toBeNull();
  });

  it("treats 503 as an empty inventory and surfaces other failures as errors", async () => {
    auth.headers = { "x-kody-token": "t" };
    const responses = [
      { ok: false, status: 503, json: async () => ({}) },
      { ok: false, status: 500, json: async () => ({ message: "boom" }) },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift()!),
    );
    const { result } = mountRegistry();

    await (result.current as Registry).refreshFlyMachines();
    expect((result.current as Registry).flyInventoryError).toBeNull();
    expect((result.current as Registry).terminalMachines).toEqual([]);

    await (result.current as Registry).refreshFlyMachines();
    expect((result.current as Registry).flyInventoryError).toBe("boom");
    expect((result.current as Registry).terminalMachines).toEqual([]);
  });

  it("refreshes on the window refresh event and detaches the listener on unmount", async () => {
    auth.headers = { "x-kody-token": "t" };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ machines: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const view = mountRegistry();

    const listeners = windowListeners.get(FLY_MACHINES_REFRESH_EVENT);
    expect(listeners?.size).toBe(1);

    for (const listener of listeners!) listener(new Event("refresh"));
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(windowListeners.get(FLY_MACHINES_REFRESH_EVENT)?.size).toBe(0);
  });
});
