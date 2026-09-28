/**
 * @fileType hook
 * @domain chat-plugin-terminal
 * @pattern chat-terminal-registry
 *
 * Per-chat terminal UI registry. Chat sessions own their terminal mode,
 * mounted terminal surface, and selected transport.
 * All state rules live in registry-state.ts (pure, behavior-tested);
 * this hook is the React wiring: state, tab-scoped persistence effects, and the
 * Fly-inventory refresh. Live session state belongs to the terminal client.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionMeta } from "../../../chat-types";
import type { ServerProviderMachineRow } from "@kody-ade/base/infrastructure/server-machine-model";
import {
  FLY_MACHINES_REFRESH_EVENT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  chatTerminalInstanceId,
  chatTerminalTransportKey,
  chatTerminalTransportsEqual,
  defaultTerminalTransport,
  loadPersistedTerminalRegistry,
  mountedChatTerminalListsEqual,
  normalizeTerminalTransport,
  pruneMountedChatTerminals,
  pruneSessionKeyedRecord,
  reconcileMountedChatTerminalsWithInventory,
  resolveTerminalTargetSelection,
  savePersistedTerminalRegistry,
  terminalRegistryStorageKey,
  terminalTargetValue,
  upsertMountedChatTerminal,
} from "./registry-state";
import type {
  ChatTerminalMode,
  ChatTerminalTransport,
  MountedChatTerminal,
} from "./types";

export type { ChatTerminalMode, MountedChatTerminal } from "./types";
export {
  BRAIN_TERMINAL_TRANSPORT,
  LOCAL_TERMINAL_TRANSPORT,
  canUseChatTerminalFlyMachine,
  findMountedBrainTerminal,
  isBrainTerminalTransport,
  normalizeMountedChatTerminals,
  normalizeTerminalTransport,
  reconcileMountedChatTerminalsWithInventory,
  terminalFlyMachineKey,
  terminalMachineIdShort,
  upsertMountedChatTerminal,
} from "./registry-state";

interface TerminalServerProviderInventory {
  machines: ServerProviderMachineRow[];
}

interface UseChatTerminalRegistryOptions {
  activeSessionId: string | null;
  createSession: () => string;
  sessions: SessionMeta[];
  sessionsHydrated?: boolean;
  storageScope?: string;
}

export function useChatTerminalRegistry({
  activeSessionId,
  createSession,
  sessions,
  sessionsHydrated = true,
  storageScope = "global",
}: UseChatTerminalRegistryOptions) {
  const storageKey = terminalRegistryStorageKey(storageScope);
  const [initialRegistryState] = useState(() =>
    loadPersistedTerminalRegistry(storageKey),
  );
  const hydratedStorageKeyRef = useRef(storageKey);
  const [pendingActiveSessionId, setPendingActiveSessionId] = useState<
    string | null
  >(null);
  const skipNextPersistRef = useRef(true);
  const [modeBySessionId, setModeBySessionId] = useState<
    Record<string, ChatTerminalMode>
  >(initialRegistryState.modeBySessionId);
  const [mountedTerminals, setMountedTerminals] = useState<
    MountedChatTerminal[]
  >(initialRegistryState.mountedTerminals);
  const [transportBySessionId, setTransportBySessionId] = useState<
    Record<string, ChatTerminalTransport>
  >(initialRegistryState.transportBySessionId);
  const [flyInventory, setServerProviderInventory] =
    useState<TerminalServerProviderInventory | null>(null);
  const [flyInventoryLoading, setServerProviderInventoryLoading] =
    useState(false);
  const [flyInventoryError, setServerProviderInventoryError] = useState<
    string | null
  >(null);
  const effectiveActiveSessionId = activeSessionId ?? pendingActiveSessionId;

  useEffect(() => {
    if (activeSessionId && pendingActiveSessionId) {
      setPendingActiveSessionId(null);
    }
  }, [activeSessionId, pendingActiveSessionId]);

  useEffect(() => {
    if (hydratedStorageKeyRef.current === storageKey) return;
    hydratedStorageKeyRef.current = storageKey;
    const persisted = loadPersistedTerminalRegistry(storageKey);
    skipNextPersistRef.current = true;
    setModeBySessionId(persisted.modeBySessionId);
    setMountedTerminals(persisted.mountedTerminals);
    setTransportBySessionId(persisted.transportBySessionId);
  }, [storageKey]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    savePersistedTerminalRegistry(storageKey, {
      version: 1,
      modeBySessionId,
      mountedTerminals,
      transportBySessionId,
    });
  }, [modeBySessionId, mountedTerminals, storageKey, transportBySessionId]);

  const mode = effectiveActiveSessionId
    ? (modeBySessionId[effectiveActiveSessionId] ?? "ai")
    : "ai";
  const terminalMachines = useMemo(
    () => (flyInventory?.machines ?? []).filter(canUseChatTerminalFlyMachine),
    [flyInventory],
  );
  const activeTransportBase = effectiveActiveSessionId
    ? (transportBySessionId[effectiveActiveSessionId] ??
      defaultTerminalTransport(terminalMachines))
    : LOCAL_TERMINAL_TRANSPORT;
  const activeTransport = normalizeTerminalTransport(
    activeTransportBase,
    terminalMachines,
    { inventoryLoaded: flyInventory !== null },
  );
  const activeInstanceId = effectiveActiveSessionId
    ? chatTerminalInstanceId(effectiveActiveSessionId, activeTransport)
    : null;
  const activeTargetValue = terminalTargetValue(activeTransport);

  const mountTerminal = useCallback(
    (sessionId: string, transport: ChatTerminalTransport) => {
      const id = chatTerminalInstanceId(sessionId, transport);
      setMountedTerminals((prev) => {
        return upsertMountedChatTerminal(prev, { id, sessionId, transport });
      });
      return id;
    },
    [],
  );

  const setSessionMode = useCallback(
    (sessionId: string, nextMode: ChatTerminalMode) => {
      setModeBySessionId((prev) =>
        prev[sessionId] === nextMode
          ? prev
          : { ...prev, [sessionId]: nextMode },
      );
    },
    [],
  );

  const setActiveMode = useCallback(
    (nextMode: ChatTerminalMode) => {
      if (!effectiveActiveSessionId) return;
      setSessionMode(effectiveActiveSessionId, nextMode);
    },
    [effectiveActiveSessionId, setSessionMode],
  );

  useEffect(() => {
    if (!sessionsHydrated) return;

    const knownSessionIds = new Set(sessions.map((session) => session.id));
    if (pendingActiveSessionId) knownSessionIds.add(pendingActiveSessionId);

    setMountedTerminals((prev) =>
      pruneMountedChatTerminals(prev, knownSessionIds),
    );
    setModeBySessionId((prev) =>
      pruneSessionKeyedRecord(prev, knownSessionIds),
    );
    setTransportBySessionId((prev) =>
      pruneSessionKeyedRecord(prev, knownSessionIds),
    );
  }, [pendingActiveSessionId, sessions, sessionsHydrated]);

  useEffect(() => {
    if (mode !== "terminal" || !effectiveActiveSessionId) return;
    if (
      flyInventory === null &&
      transportBySessionId[effectiveActiveSessionId] === undefined
    ) {
      return;
    }
    mountTerminal(effectiveActiveSessionId, activeTransport);
  }, [
    activeTransport,
    effectiveActiveSessionId,
    flyInventory,
    mode,
    mountTerminal,
    transportBySessionId,
  ]);

  const openTerminalMode = useCallback(
    (transport?: ChatTerminalTransport) => {
      const sessionId = effectiveActiveSessionId ?? createSession();
      if (!activeSessionId) setPendingActiveSessionId(sessionId);
      const explicitTransport = transport ?? transportBySessionId[sessionId];
      const terminalTransport = normalizeTerminalTransport(
        explicitTransport ?? defaultTerminalTransport(terminalMachines),
        terminalMachines,
        { inventoryLoaded: flyInventory !== null },
      );
      if (explicitTransport || flyInventory !== null) {
        mountTerminal(sessionId, terminalTransport);
      }
      if (transport) {
        setTransportBySessionId((prev) =>
          prev[sessionId] &&
          chatTerminalTransportKey(prev[sessionId]) ===
            chatTerminalTransportKey(terminalTransport)
            ? prev
            : { ...prev, [sessionId]: terminalTransport },
        );
      }
      setSessionMode(sessionId, "terminal");
      return sessionId;
    },
    [
      createSession,
      effectiveActiveSessionId,
      flyInventory,
      mountTerminal,
      setSessionMode,
      terminalMachines,
      transportBySessionId,
    ],
  );

  const refreshFlyMachines = useCallback(async () => {
    setServerProviderInventoryLoading(true);
    setServerProviderInventoryError(null);
    try {
      const res = await fetch("/api/kody/brain/status");
      if (res.status === 503) {
        setServerProviderInventory({ machines: [] });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const body =
        (await res.json()) as Partial<TerminalServerProviderInventory>;
      setServerProviderInventory({ machines: body.machines ?? [] });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load Fly machines";
      setServerProviderInventoryError(message);
      setServerProviderInventory({ machines: [] });
    } finally {
      setServerProviderInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void refreshFlyMachines();
    window.addEventListener(FLY_MACHINES_REFRESH_EVENT, refresh);
    return () =>
      window.removeEventListener(FLY_MACHINES_REFRESH_EVENT, refresh);
  }, [refreshFlyMachines]);

  useEffect(() => {
    if (mode !== "terminal") return;
    void refreshFlyMachines();
  }, [effectiveActiveSessionId, mode, refreshFlyMachines]);

  useEffect(() => {
    if (flyInventory === null) return;
    setMountedTerminals((prev) => {
      const next = reconcileMountedChatTerminalsWithInventory(
        prev,
        terminalMachines,
        { inventoryLoaded: true },
      );
      return mountedChatTerminalListsEqual(prev, next) ? prev : next;
    });
    setTransportBySessionId((prev) => {
      let changed = false;
      const next: Record<string, ChatTerminalTransport> = {};
      for (const [sessionId, transport] of Object.entries(prev)) {
        const normalized = normalizeTerminalTransport(
          transport,
          terminalMachines,
          { inventoryLoaded: true },
        );
        next[sessionId] = normalized;
        if (!chatTerminalTransportsEqual(transport, normalized)) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [flyInventory, terminalMachines]);

  const setActiveTransport = useCallback(
    (transport: ChatTerminalTransport) => {
      if (!effectiveActiveSessionId) return;
      const nextTransport = normalizeTerminalTransport(
        transport,
        terminalMachines,
        { inventoryLoaded: flyInventory !== null },
      );
      mountTerminal(effectiveActiveSessionId, nextTransport);
      setTransportBySessionId((prev) =>
        prev[effectiveActiveSessionId] &&
        chatTerminalTransportKey(prev[effectiveActiveSessionId]) ===
          chatTerminalTransportKey(nextTransport)
          ? prev
          : { ...prev, [effectiveActiveSessionId]: nextTransport },
      );
    },
    [effectiveActiveSessionId, flyInventory, mountTerminal, terminalMachines],
  );

  const selectTarget = useCallback(
    (value: string) => {
      const transport = resolveTerminalTargetSelection(value, terminalMachines);
      if (!transport) return;
      setActiveTransport(transport);
    },
    [setActiveTransport, terminalMachines],
  );

  return {
    activeInstanceId,
    activeTargetValue,
    activeTransport,
    flyInventoryError,
    flyInventoryLoading,
    mode,
    modeBySessionId,
    mountedTerminals,
    openTerminalMode,
    refreshFlyMachines,
    restoreTerminalTransport: setActiveTransport,
    selectTarget,
    setActiveMode,
    terminalMachines,
    transportBySessionId,
  };
}
