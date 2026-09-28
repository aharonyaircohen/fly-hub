"use client";

/**
 * @fileType hook
 * @domain chat-host
 * @pattern kody-chat-extraction (phase 1.6d)
 *
 * Terminal HOST wiring for KodyChat — everything the chat surface needs
 * to mount, drive and persist chat terminals, extracted verbatim from
 * KodyChat.tsx (phase 1.6d). Owns:
 *   - the per-mount terminal registry (useChatTerminalRegistry) + aliases
 *   - display-mode arbitration (registry.resolveDisplayMode → chatMode)
 *   - checkpoint saves
 *   - Kody→terminal payload hand-off (sendKodyTerminalPayloadToTerminal)
 *   - composer→terminal line sends (sendInputToTerminal)
 *   - terminal chrome state (per-instance ChatTerminalChromeState) and
 *     the derived send-busy/disabled/problem flags
 *   - the lazy-loaded terminal chrome ReactNodes (toggle / top / bottom)
 *     and the mounted ChatTerminalSurface elements
 *
 * Lives in the components zone (not chat/plugins/terminal) on purpose:
 * this is HOST state — it reads the host's session hook, composer state
 * and plugin registry. Moving it into the terminal plugin would invert
 * the plugin→host dependency direction.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import type { SessionMeta } from "../chat-types";
import type { ChatPluginRegistry } from "../chat/platform";
import { authHeaders } from "../kody-chat-live-session";
// Terminal plugin — deep imports on purpose (Step 7 bundle check). The
// barrel (plugins/terminal/index.ts) statically reaches ChatTerminalSurface,
// terminal session client and TerminalControls; importing it here would drag the
// whole plugin into EVERY route chunk that renders KodyChat, including
// /client. Statics below are the small always-needed halves (hooks can't be
// lazy; the effect reader/checkpoint helpers run on every send path); the
// heavy render-gated components load via React.lazy further down.
import { LOCAL_TERMINAL_TRANSPORT } from "../chat/plugins/terminal/registry-state";
import { TERMINAL_DISPLAY_MODE } from "../chat/plugins/terminal/mode";
import { checkpointTransportFromChatTransport } from "../chat/plugins/terminal/checkpoints";
import { TerminalTopControls } from "../chat/plugins/terminal/TerminalControls";
import { useBrainImageSave } from "../chat/plugins/terminal/use-brain-image-save";
import { useChatTerminalRegistry } from "../chat/plugins/terminal/useChatTerminalRegistry";
import type {
  ChatTerminalMode,
  ChatTerminalChromeState,
  ChatTerminalSnapshot,
  ChatTerminalTransport,
} from "../chat/plugins/terminal/types";
import type { ChatTerminalSurfaceHandle } from "../chat/plugins/terminal/ChatTerminalSurface";
import { type TerminalCheckpoint } from "@kody-ade/terminal/checkpoint-types";

// Render-gated terminal plugin components (Step 7 bundle check): loaded via
// React.lazy so the xterm surface, Fly connection stack and terminal chrome
// land in their own async chunks instead of every KodyChat route chunk.
// /client never renders them (hideTerminalMode + no terminal plugin in the
// grant), so their chunks are never fetched there. Each render site wraps
// them in <Suspense fallback={null}> — the admin toggle/toolbars appear as
// soon as the (tiny) chunk resolves; Playwright's visibility waits cover it.
const ChatTerminalSurface = lazy(() =>
  import("../chat/plugins/terminal/ChatTerminalSurface").then((m) => ({
    default: m.ChatTerminalSurface,
  })),
);
const TerminalModeToggle = lazy(() =>
  import("../chat/plugins/terminal/TerminalControls").then((m) => ({
    default: m.TerminalModeToggle,
  })),
);
const TerminalBottomControls = lazy(() =>
  import("../chat/plugins/terminal/TerminalControls").then((m) => ({
    default: m.TerminalBottomControls,
  })),
);

interface UseTerminalHostOptions {
  actorLogin?: string | null;
  vibeMode?: boolean;
  hideTerminalMode?: boolean;
  lockedAgentId?: string;
  pluginRegistry: ChatPluginRegistry;
  activeSessionIdForReset: string | null;
  createChatSession: () => string;
  sessions: SessionMeta[];
  sessionsHydrated: boolean;
  sessionStoreScope: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  setContextChips: Dispatch<
    SetStateAction<Array<{ id: string; label: string; context: string }>>
  >;
}

export interface TerminalHost {
  chatMode: ChatTerminalMode;
  modeBySessionId: Record<string, ChatTerminalMode>;
  sendInputToTerminal: () => void;
  sendKodyTerminalPayloadToTerminal: (payload: string) => boolean;
  terminalSendBusy: boolean | undefined;
  terminalSendDisabled: boolean | undefined;
  terminalInputLabel: string | undefined;
  chatModeToggle: ReactNode;
  terminalTopControls: ReactNode;
  terminalBottomControls: ReactNode;
  terminalSurfaces: ReactNode[];
  openTerminalMode: () => void;
  setActiveChatMode: (mode: ChatTerminalMode) => void;
}

export function useTerminalHost({
  actorLogin,
  vibeMode,
  hideTerminalMode,
  lockedAgentId,
  pluginRegistry,
  activeSessionIdForReset,
  createChatSession,
  sessions,
  sessionsHydrated,
  sessionStoreScope,
  input,
  setInput,
  setSlashMenuOpen,
  setSlashSelectedIndex,
  composerTextareaRef,
  setContextChips,
}: UseTerminalHostOptions): TerminalHost {
  const terminalRegistry = useChatTerminalRegistry({
    activeSessionId: activeSessionIdForReset,
    createSession: createChatSession,
    sessions,
    sessionsHydrated,
    storageScope: sessionStoreScope,
  });
  // Display-mode arbitration (plan H2d): the terminal plugin DECLARES the
  // "terminal" mode; the platform resolves it. Vibe is a HOST mode — the
  // host forces "ai", which always wins, so vibe-suppresses-terminal never
  // becomes a plugin→plugin import. With the terminal plugin unregistered
  // (hosts that omit it, e.g. ClientChatSurface) the mode can never
  // resolve to "terminal"; `hideTerminalMode` stays as the belt-and-braces
  // visibility gate on the toggle below.
  const resolvedDisplayMode = pluginRegistry.resolveDisplayMode(
    [terminalRegistry.mode],
    vibeMode ? "ai" : undefined,
  );
  const chatMode: ChatTerminalMode =
    resolvedDisplayMode === TERMINAL_DISPLAY_MODE ? "terminal" : "ai";
  const terminalMachines = terminalRegistry.terminalMachines;
  const activeTerminalTransport = terminalRegistry.activeTransport;
  const activeTerminalInstanceId = terminalRegistry.activeInstanceId;
  const activeTerminalValue = terminalRegistry.activeTargetValue;
  const mountedChatTerminals = terminalRegistry.mountedTerminals;
  const flyInventoryLoading = terminalRegistry.flyInventoryLoading;
  const flyInventoryError = terminalRegistry.flyInventoryError;
  const setActiveChatMode = terminalRegistry.setActiveMode;
  const refreshChatTerminalFlyMachines = terminalRegistry.refreshFlyMachines;
  const handleTerminalTargetChange = terminalRegistry.selectTarget;
  const [terminalChromeById, setTerminalChromeById] = useState<
    Record<string, ChatTerminalChromeState>
  >({});
  const activeTerminalChrome = activeTerminalInstanceId
    ? terminalChromeById[activeTerminalInstanceId]
    : null;
  const activeTerminalConnectionState =
    activeTerminalChrome?.connection ?? "idle";
  const activeSessionHasLiveTerminal = mountedChatTerminals.some(
    (terminal) =>
      terminal.sessionId === activeSessionIdForReset &&
      ["connected", "connecting", "restoring"].includes(
        terminalChromeById[terminal.id]?.connection ?? "idle",
      ),
  );
  const terminalStatusLabel =
    activeTerminalConnectionState === "connected"
      ? "On"
      : activeTerminalConnectionState === "connecting"
        ? "Starting"
        : "Off";
  // Brain image save action + status (plugin hook — called here so a save
  // keeps polling while the user leaves terminal mode).
  const brainImageSave = useBrainImageSave();
  const [pendingKodyTerminalPayload, setPendingKodyTerminalPayload] = useState<
    string | null
  >(null);

  const terminalSurfaceRefs: MutableRefObject<
    Record<string, ChatTerminalSurfaceHandle | null>
  > = useRef({});

  // Brain image replacement changes the machine behind the logical Brain
  // target. Invalidate the visible terminal immediately, then create a fresh
  // server session once the apply request reports success. This prevents the
  // user from being left with a connected-looking terminal backed by the old
  // machine.
  useEffect(() => {
    const handleBrainRuntimeChange = (event: Event) => {
      if (activeTerminalTransport.type !== "brain") return;
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      const terminal = activeTerminalInstanceId
        ? terminalSurfaceRefs.current[activeTerminalInstanceId]
        : null;
      if (!terminal) return;
      if (phase === "start" || phase === "failed") {
        terminal.prepareForRuntimeChange();
      } else if (phase === "complete") {
        void terminal.reconnectFresh();
      }
    };
    window.addEventListener(
      "kody:brain-runtime-change",
      handleBrainRuntimeChange,
    );
    return () =>
      window.removeEventListener(
        "kody:brain-runtime-change",
        handleBrainRuntimeChange,
      );
  }, [activeTerminalInstanceId, activeTerminalTransport.type]);

  const saveTerminalCheckpoint = useCallback(
    async (
      terminal: { sessionId: string; transport: ChatTerminalTransport },
      snapshot: ChatTerminalSnapshot,
    ) => {
      if (!snapshot.output.trim()) return false;
      try {
        const res = await fetch("/api/kody/chat/terminal/checkpoint", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            actorLogin,
            transport: checkpointTransportFromChatTransport(terminal.transport),
            chatSessionId: terminal.sessionId,
            cwd: snapshot.cwd,
            shell: snapshot.shell,
            output: snapshot.output,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          checkpoint?: TerminalCheckpoint;
          message?: string;
          error?: string;
        };
        if (!res.ok || !body.checkpoint) {
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to save terminal checkpoint",
        );
        return false;
      }
    },
    [actorLogin],
  );

  const sendKodyTerminalPayloadToTerminal = useCallback(
    (payload: string) => {
      const terminalPayload = payload.trimEnd();
      if (!terminalPayload.trim()) {
        toast.error("Kody returned an empty terminal payload");
        return false;
      }
      const payloadWithEnter = `${terminalPayload}\n`;
      terminalRegistry.openTerminalMode(LOCAL_TERMINAL_TRANSPORT);

      if (
        activeTerminalTransport.type === "local" &&
        activeTerminalInstanceId &&
        activeTerminalConnectionState === "connected"
      ) {
        const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
        if (terminal?.executeText(payloadWithEnter)) {
          terminal.focus();
          toast.success("Sent to terminal");
          return true;
        }
      }

      setPendingKodyTerminalPayload(payloadWithEnter);
      return true;
    },
    [
      activeTerminalConnectionState,
      activeTerminalInstanceId,
      activeTerminalTransport.type,
      terminalRegistry,
    ],
  );

  useEffect(() => {
    if (!pendingKodyTerminalPayload) return;
    if (chatMode !== "terminal") return;
    if (activeTerminalTransport.type !== "local") return;
    if (!activeTerminalInstanceId) return;
    if (activeTerminalConnectionState !== "connected") return;

    const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
    if (!terminal?.executeText(pendingKodyTerminalPayload)) return;

    setPendingKodyTerminalPayload(null);
    terminal.focus();
    toast.success("Sent to terminal");
  }, [
    activeTerminalConnectionState,
    activeTerminalInstanceId,
    activeTerminalTransport.type,
    chatMode,
    pendingKodyTerminalPayload,
  ]);
  const handleTerminalTargetSelect = useCallback(
    (value: string) => {
      handleTerminalTargetChange(value);
    },
    [handleTerminalTargetChange],
  );

  const addTerminalContextToChat = useCallback(
    (context: string) => {
      setContextChips((prev) => [
        ...prev,
        {
          id: `terminal-output-${Date.now()}`,
          label: "Terminal output",
          context,
        },
      ]);
      setActiveChatMode("ai");
      toast.success("Terminal output added to next chat message");
    },
    [setActiveChatMode, setContextChips],
  );

  const openTerminalMode = useCallback(() => {
    terminalRegistry.openTerminalMode();
    setSlashMenuOpen(false);
  }, [terminalRegistry, setSlashMenuOpen]);

  const sendInputToTerminal = useCallback(() => {
    const command = input;
    if (!command.trim()) return;
    if (!activeTerminalInstanceId) {
      toast.error("Terminal is not ready yet");
      return;
    }

    const terminal = terminalSurfaceRefs.current[activeTerminalInstanceId];
    if (!terminal) {
      toast.error("Terminal is still opening");
      return;
    }

    if (!terminal.sendLine(command)) {
      toast.error("Terminal is not connected yet");
      terminal.focus();
      return;
    }

    setInput("");
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalInstanceId, input]);

  // Terminal chrome — plugin components passed as HOST ReactNodes (not
  // registry slots) so the DOM stays byte-identical (see
  // chat/plugins/terminal/TerminalControls.tsx). Visibility rules are host
  // state: no toggle when the surface hides terminal mode, pins an agent,
  // or runs vibe.
  const chatModeToggle =
    !hideTerminalMode &&
    !lockedAgentId &&
    !vibeMode &&
    pluginRegistry.resolveDisplayMode([TERMINAL_DISPLAY_MODE]) ===
      TERMINAL_DISPLAY_MODE ? (
      <Suspense fallback={null}>
        <TerminalModeToggle
          chatMode={chatMode}
          terminalStatusLabel={terminalStatusLabel}
          hasLiveTerminal={activeSessionHasLiveTerminal}
          connectionState={activeTerminalConnectionState}
          onSelectAiMode={() => setActiveChatMode("ai")}
          onOpenTerminal={openTerminalMode}
        />
      </Suspense>
    ) : null;

  const terminalTopControls =
    chatMode === "terminal" ? (
      <TerminalTopControls
        activeTargetValue={activeTerminalValue}
        onSelectTarget={handleTerminalTargetSelect}
        activeTransport={activeTerminalTransport}
        terminalMachines={terminalMachines}
        flyInventoryError={flyInventoryError}
        flyInventoryLoading={flyInventoryLoading}
        onRefreshMachines={() => void refreshChatTerminalFlyMachines()}
        brainImageBusy={brainImageSave.busy}
        brainImageSaveLabel={brainImageSave.label}
        onSaveBrainImage={() => void brainImageSave.save()}
      />
    ) : null;
  const activeTerminalSurface = activeTerminalInstanceId
    ? terminalSurfaceRefs.current[activeTerminalInstanceId]
    : null;
  const terminalInputTone = activeTerminalChrome?.inputTone ?? "idle";
  const terminalSendBusy =
    chatMode === "terminal" &&
    (terminalInputTone === "queued" || activeTerminalChrome?.actionBusy);
  const terminalSendDisabled =
    chatMode === "terminal" &&
    (terminalInputTone === "blocked" || terminalSendBusy);
  const terminalBottomControls =
    chatMode === "terminal" ? (
      <Suspense fallback={null}>
        <TerminalBottomControls
          onAddToChat={() => activeTerminalSurface?.addToChat()}
          onRestart={() => activeTerminalSurface?.restart()}
          onClear={() => activeTerminalSurface?.clear()}
          actionBusy={activeTerminalChrome?.actionBusy}
          restartDisabled={activeTerminalConnectionState !== "connected"}
          layout="menu"
        />
      </Suspense>
    ) : null;

  const terminalSurfaces = mountedChatTerminals.map((terminal) => {
    const isActiveTerminal =
      chatMode === "terminal" &&
      activeSessionIdForReset === terminal.sessionId &&
      activeTerminalInstanceId === terminal.id;
    return (
      <div
        key={terminal.id}
        className={isActiveTerminal ? "h-full min-h-0" : "hidden"}
      >
        <Suspense fallback={null}>
          <ChatTerminalSurface
            ref={(node) => {
              terminalSurfaceRefs.current[terminal.id] = node;
              if (!node) delete terminalSurfaceRefs.current[terminal.id];
            }}
            active={isActiveTerminal}
            chatSessionId={terminal.sessionId}
            transport={terminal.transport}
            topToolbar={terminalTopControls}
            onAddToChat={addTerminalContextToChat}
            onChromeStateChange={(state) => {
              setTerminalChromeById((existing) => {
                const current = existing[terminal.id];
                if (
                  current &&
                  current.connection === state.connection &&
                  current.statusText === state.statusText &&
                  current.inputLabel === state.inputLabel &&
                  current.inputTone === state.inputTone &&
                  current.actionBusy === state.actionBusy
                ) {
                  return existing;
                }
                return { ...existing, [terminal.id]: state };
              });
            }}
            onSessionEnded={(snapshot) =>
              void saveTerminalCheckpoint(terminal, snapshot)
            }
          />
        </Suspense>
      </div>
    );
  });

  return {
    chatMode,
    modeBySessionId: terminalRegistry.modeBySessionId,
    sendInputToTerminal,
    sendKodyTerminalPayloadToTerminal,
    terminalSendBusy,
    terminalSendDisabled,
    terminalInputLabel: activeTerminalChrome?.inputLabel,
    chatModeToggle,
    terminalTopControls,
    terminalBottomControls,
    terminalSurfaces,
    openTerminalMode,
    setActiveChatMode,
  };
}
