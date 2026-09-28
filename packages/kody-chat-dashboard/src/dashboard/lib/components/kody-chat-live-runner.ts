/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-live-runner
 * @ai-summary The Kody Live runner lifecycle extracted from KodyChat
 *   (phase 1.6a): the live reducer orchestration (dispatchLive + legacy
 *   ref mirrors), localStorage persistence + scope rehydration effects,
 *   the live-transport event subscription (runner + scoped, with a
 *   visibility gate), the start/end/restart session actions, and the
 *   zombie-runner watchdog. Events arrive exclusively through the
 *   platform "live-transport" plugin (Convex reactive stream) — the
 *   legacy SSE (/api/kody/events/stream) and 3s interval poll
 *   (/api/kody/events/poll) fallbacks were removed once Convex became
 *   mandatory. A missing transport (browser built without
 *   NEXT_PUBLIC_CONVEX_URL) degrades to an explicit in-chat error, not
 *   silence. UI side effects (agent picker writes, session mirroring)
 *   stay in KodyChat and are injected via `onRehydrateRestored`.
 *
 *   Placement note: this module lives in components/ (not chat/core)
 *   because it necessarily imports the components-zone `Message` type
 *   and the vibe plugin's turn-context helpers — both forbidden imports
 *   for chat/core under the layer zones in eslint.config.mjs. The pure
 *   decision logic it relies on (reducer transitions, persistence
 *   decisions, rehydrate actions) already lives zone-clean in
 *   chat/core/kody-chat-reducer.ts and chat/core/rehydration.ts.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  liveReducer,
  initialLiveState,
  isWatchdogActive,
  type LivePhase,
  type LiveAction,
  type LiveSessionState,
} from "../chat/core/kody-chat-reducer";
import {
  authHeaders,
  getLiveScopeKey,
  loadLiveSession,
  saveLiveSession,
  clearLiveSession,
  liveAuthFor,
  liveAuthHeaders,
  type LiveScopeKey,
} from "../kody-chat-live-session";
import {
  buildRehydrateAction,
  decideLivePersistence,
  shouldRehydrateScope,
} from "../chat/core/rehydration";
import { getStoredFlyPerf } from "../integration-api";
import { getChatLiveTransport } from "../chat/platform/live-transport";
import type { AgentId } from "../agents";
import type { ChatContext } from "../chat-types";
import { vibeTurnFields, type VibeLiveTaskContext } from "../chat/plugins/vibe";
import type { Message } from "./kody-chat-types";

type MessagesUpdater = Message[] | ((prev: Message[]) => Message[]);

export interface UseLiveRunnerOptions {
  /** The currently selected agent — drives the Fly vs GHA start route. */
  selectedAgentId: AgentId;
  /** Host chat context (task / capability / report / …). */
  context: ChatContext | null | undefined;
  vibeMode?: boolean;
  /** Task id when the chat is scoped to a task (drives the scoped SSE). */
  selectedTaskId: string | null;
  /** Capability slug when scoped to a capability (drives the scoped SSE). */
  capabilitySlug: string | null;
  /** The active UI session id events should be written back to. */
  activeSessionIdForReset: string | null;
  /** Chat-level thinking pick forwarded to /interactive/start. */
  effectiveReasoningEffort: string | null;
  setLoading: (loading: boolean) => void;
  /** Write messages into the ACTIVE session. */
  setMessages: (updater: MessagesUpdater) => void;
  /** Write messages into a SPECIFIC session (turns outlive session switches). */
  setMessagesForSession: (sessionId: string, updater: MessagesUpdater) => void;
}

export interface UseLiveRunnerResult {
  liveState: LiveSessionState;
  liveStateRef: React.MutableRefObject<LiveSessionState>;
  dispatchLive: (action: LiveAction) => void;
  /** Legacy synchronous mirrors — post-dispatch reads see fresh values. */
  interactiveSessionIdRef: React.MutableRefObject<string | null>;
  interactiveStateRef: React.MutableRefObject<LivePhase>;
  interactiveTargetRef: React.MutableRefObject<{
    owner: string;
    repo: string;
  } | null>;
  currentScopeKeyRef: React.MutableRefObject<LiveScopeKey>;
  /** Seconds since boot started — drives the booting banner countdown. */
  bootElapsed: number;
  /**
   * Handle for the scoped (task/capability) live subscription. Kept under
   * the legacy name so host call sites (`eventSourceRef.current?.close()`)
   * keep working — the underlying channel is a live-transport subscription
   * now, not an EventSource.
   */
  eventSourceRef: React.MutableRefObject<{ close: () => void } | null>;
  connectSSE: (
    sessionId: string,
    opts?: { interactive?: boolean; uiSessionId?: string | null },
  ) => void;
  startInteractivePoll: (
    sessionId: string,
    uiSessionId?: string | null,
  ) => void;
  stopInteractivePoll: () => void;
  startInteractiveSession: (opts?: LiveSessionStartOptions) => Promise<void>;
  endInteractiveSession: () => void;
  restartInteractiveSession: (opts?: LiveSessionStartOptions) => Promise<void>;
  rehydrateForScope: (scopeKey: LiveScopeKey) => void;
}

/**
 * Watchdog probe budget. Each watchdog deadline (150s booting / 240s
 * awaiting) that ends in an inconclusive status check — fetch failed, or
 * the server said "alive" while still no event reached the client — spends
 * one probe. Exhausting the budget marks the session stuck so the Restart
 * banner appears, instead of trusting an unverifiable "alive" forever.
 * 3 probes ≈ 12 minutes of total event silence in the awaiting phase.
 */
export const WATCHDOG_MAX_INCONCLUSIVE_PROBES = 3;

/** Runner event shape emitted by the live transport (parsed, deduped, seq-ordered). */
type RunnerEvent = {
  event?: string;
  payload?: Record<string, unknown>;
};

/**
 * Shown (once) when no live transport is registered — i.e. the browser
 * bundle was built without NEXT_PUBLIC_CONVEX_URL. Convex is mandatory;
 * there is no polling/SSE fallback anymore, so the failure must be loud.
 */
export const MISSING_LIVE_TRANSPORT_MESSAGE =
  "Live events are unavailable: this deployment was built without " +
  "NEXT_PUBLIC_CONVEX_URL, so the Convex live transport is not registered. " +
  "Set NEXT_PUBLIC_CONVEX_URL (same value as CONVEX_URL) and redeploy.";

export interface LiveSessionStartOptions {
  initialContent?: string;
  initialTimestamp?: string;
  taskContext?: VibeLiveTaskContext;
  uiSessionId?: string | null;
}

/**
 * Kody Live (long-lived runner) lifecycle — single reducer owns phase +
 * session id + target + run url + boot timestamp + last-event timestamp +
 * the vibe auto-kickoff queue. Every transition goes through `dispatchLive`,
 * which (a) recomputes the next state, (b) writes a synchronous mirror to
 * `liveStateRef` so closure-captured reads see fresh values immediately,
 * and (c) calls React's setState so the UI re-renders. See
 * kody-chat-reducer.ts for the action surface and transition table.
 *
 * Legacy phases ('idle' | 'booting' | 'ready' | 'ended') are extended with
 * 'awaiting' (turn in flight), 'error' (start failed or chat.error), and
 * 'stuck' (watchdog/status check declared the runner zombie).
 */
export function useLiveRunner({
  selectedAgentId,
  context,
  vibeMode,
  selectedTaskId,
  capabilitySlug,
  activeSessionIdForReset,
  effectiveReasoningEffort,
  setLoading,
  setMessages,
  setMessagesForSession,
}: UseLiveRunnerOptions): UseLiveRunnerResult {
  // Restore an in-progress Kody Live session after a page refresh. Reads
  // localStorage on mount; if a non-stale session exists, restores runner
  // state and reconnects the SSE so chat.ready / chat.message / chat.exit
  // continue to flow. The conversation's agentKey remains the picker source
  // of truth, so a delayed restore cannot override a user's explicit choice.
  const liveRestoreAttemptedRef = useRef(false);
  const eventSourceRef = useRef<{ close: () => void } | null>(null);
  // Consecutive inconclusive watchdog probes (see the watchdog effect at
  // the bottom of this hook). Reset to 0 by handleEvents on any real
  // runner event; at WATCHDOG_MAX_INCONCLUSIVE_PROBES the session is
  // force-marked stuck.
  const watchdogProbesRef = useRef(0);

  const liveStateRef = useRef<LiveSessionState>(initialLiveState);
  const [liveState, setLiveState] =
    useState<LiveSessionState>(initialLiveState);
  const dispatchLive = useCallback((action: LiveAction) => {
    const next = liveReducer(liveStateRef.current, action);
    liveStateRef.current = next;
    setLiveState(next);
    // Keep the legacy named refs in sync so closure readers don't go stale.
    interactiveSessionIdRef.current = next.sessionId;
    interactiveStateRef.current = next.phase;
    interactiveTargetRef.current = next.target;
    currentScopeKeyRef.current = next.scopeKey;
  }, []);

  // Legacy refs kept for the many closure readers in KodyChat. Source of
  // truth is `liveStateRef`; these are updated by `dispatchLive` above so
  // a post-dispatch read in the same tick sees the new value.
  const interactiveSessionIdRef = useRef<string | null>(null);
  const interactiveStateRef = useRef<LivePhase>("idle");
  const interactiveTargetRef = useRef<{ owner: string; repo: string } | null>(
    null,
  );
  const currentScopeKeyRef = useRef<LiveScopeKey>("global");

  // Boot-elapsed ticker — drives the banner countdown while booting.
  const [bootElapsed, setBootElapsed] = useState(0);
  useEffect(() => {
    if (liveState.phase !== "booting" || !liveState.bootStartedAt) {
      setBootElapsed(0);
      return;
    }
    const tick = () =>
      setBootElapsed(
        Math.floor(
          (Date.now() - (liveState.bootStartedAt ?? Date.now())) / 1000,
        ),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [liveState.phase, liveState.bootStartedAt]);

  // Persist the live-session record to localStorage whenever the reducer
  // moves through booting/ready, and clear it when we leave those phases.
  // Centralising the persistence here means start/ready/exit/error/stuck
  // all share one storage path — fixes a previous foot-gun where some
  // mutation sites forgot to save or clear.
  //
  // CRITICAL: on first mount, the reducer is in its initial { phase: 'idle',
  // sessionId: null } state. The rehydrate effect (further down) reads
  // localStorage and dispatches REHYDRATE_RESTORED. If THIS effect ran on
  // mount and called clearLiveSession, it would wipe the saved record
  // BEFORE rehydrate gets to read it — symptom: refresh-during-session
  // loses the session. We skip the initial-idle case via a ref, only
  // clearing on a genuine transition INTO idle/ended/etc.
  const persistenceMountedRef = useRef(false);
  useEffect(() => {
    // Decision logic lives in chat/core/rehydration.ts (pure, unit-tested);
    // this effect only performs the storage side effects it prescribes.
    const decision = decideLivePersistence(
      liveState,
      persistenceMountedRef.current,
    );
    switch (decision.kind) {
      case "save":
        saveLiveSession(decision.scopeKey, decision.record);
        persistenceMountedRef.current = true;
        return;
      case "skip-initial":
        // First render with idle/null state — leave any persisted record
        // alone; the rehydrate effect below will pick it up.
        persistenceMountedRef.current = true;
        return;
      case "clear":
        clearLiveSession(decision.scopeKey);
        return;
      case "none":
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    liveState.phase,
    liveState.sessionId,
    liveState.scopeKey,
    liveState.bootStartedAt,
    liveState.target,
    liveState.runUrl,
  ]);

  // ─── Live events for Kody Live ─────────────────────────────────────────────
  // Events arrive exclusively through the plugin-supplied live transport
  // (platform "live-transport" contract, chat/platform/live-transport.ts —
  // the Convex reactive stream in the dashboard). Transports emit events
  // already parsed, deduplicated and seq-ordered. Convex is mandatory:
  // there is no interval-poll or SSE fallback anymore. A missing transport
  // surfaces MISSING_LIVE_TRANSPORT_MESSAGE in the chat instead of
  // silently never updating.
  const liveTransportUnsubRef = useRef<(() => void) | null>(null);
  const missingTransportReportedRef = useRef(false);

  const stopInteractivePoll = useCallback(() => {
    if (liveTransportUnsubRef.current) {
      liveTransportUnsubRef.current();
      liveTransportUnsubRef.current = null;
    }
  }, []);

  // Surface the missing-transport condition once per mount: stop the
  // typing indicator and drop an explicit error bubble into the chat.
  const reportMissingTransport = useCallback(
    (writeMessages: (updater: MessagesUpdater) => void) => {
      setLoading(false);
      if (missingTransportReportedRef.current) return;
      missingTransportReportedRef.current = true;
      writeMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${MISSING_LIVE_TRANSPORT_MESSAGE}`,
          isLoading: false,
          isError: true,
        },
      ]);
    },
    [setLoading],
  );

  // One handler serves both the runner-scoped and task/capability-scoped
  // subscriptions. `onExit` closes the channel the events arrived on.
  const buildEventHandler = useCallback(
    (
        writeMessages: (updater: MessagesUpdater) => void,
        onExit: () => void,
      ) =>
      (events: ReadonlyArray<RunnerEvent | null>) => {
        // Any real runner event is proof of life — reset the watchdog's
        // inconclusive-probe budget (see the watchdog effect below).
        watchdogProbesRef.current = 0;
        for (const event of events) {
          if (!event || !event.event) continue;
          const payload = event.payload ?? {};
          switch (event.event) {
            case "chat.ready": {
              const runUrl =
                typeof payload.runUrl === "string" ? payload.runUrl : undefined;
              dispatchLive({ type: "RUNNER_READY", runUrl });
              break;
            }
            case "chat.exit": {
              dispatchLive({ type: "RUNNER_EXIT" });
              setLoading(false);
              onExit();
              break;
            }
            case "chat.message": {
              // Hazard D fix: an assistant message always returns the
              // session to ready, so the typing indicator can never outlive
              // the reply even if chat.done is dropped.
              dispatchLive({ type: "MESSAGE_RECEIVED" });
              setLoading(false);
              const role =
                payload.role === "user" || payload.role === "assistant"
                  ? payload.role
                  : "assistant";
              const content =
                typeof payload.content === "string" ? payload.content : "";
              const timestamp =
                typeof payload.timestamp === "string"
                  ? payload.timestamp
                  : new Date().toISOString();
              writeMessages((prev) => {
                // Inherit mid-turn progress from the in-flight bubble: any
                // <think> blocks already accumulated from chat.thinking, and
                // all tool-call cards from chat.tool. Without this, when all
                // events arrive together (engine commits at end of turn),
                // chat.message would replace the in-flight with a clean
                // final, erasing the reasoning + tool history.
                const inflight = prev.find(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                const carriedReasoning = inflight?.content ?? "";
                const carriedToolCalls = inflight?.toolCalls;
                return [
                  ...prev.filter(
                    (m) => !(m.role === "assistant" && m.isLoading),
                  ),
                  {
                    role,
                    content: carriedReasoning + content,
                    timestamp,
                    isLoading: false,
                    ...(carriedToolCalls && carriedToolCalls.length > 0
                      ? { toolCalls: carriedToolCalls }
                      : {}),
                  },
                ];
              });
              break;
            }
            case "chat.done":
              dispatchLive({ type: "TURN_DONE" });
              setLoading(false);
              break;
            case "chat.error": {
              const error =
                typeof payload.error === "string"
                  ? payload.error
                  : "Unknown error";
              dispatchLive({ type: "RUNNER_ERROR", errorMessage: error });
              setLoading(false);
              writeMessages((prev) => {
                const filtered = prev.filter(
                  (m) => !(m.role === "assistant" && m.isLoading),
                );
                return [
                  ...filtered,
                  {
                    role: "assistant",
                    content: `Error: ${error}`,
                    isLoading: false,
                    isError: true,
                  },
                ];
              });
              break;
            }
            // Mid-turn progress from Kody Live (engine ≥ 0.4.69). The
            // polling path is the ACTIVE one in production (the SSE path
            // has the same handlers but isn't currently exercised by
            // KodyChat) — both must stay in sync.
            case "chat.thinking": {
              const chunk =
                typeof payload.text === "string" ? payload.text : "";
              if (!chunk) break;
              const block = `<think>${chunk}</think>`;
              writeMessages((prev) => {
                const copy = [...prev];
                const idx = copy.findIndex(
                  (m) => m.role === "assistant" && m.isLoading,
                );
                if (idx < 0) {
                  copy.push({
                    role: "assistant",
                    content: block,
                    timestamp: new Date().toISOString(),
                    isLoading: true,
                  });
                } else {
                  copy[idx] = {
                    ...copy[idx],
                    content: copy[idx].content + block,
                  };
                }
                return copy;
              });
              break;
            }
            case "chat.tool": {
              const phase = payload.phase;
              if (phase === "result") {
                const toolUseId =
                  typeof payload.toolUseId === "string"
                    ? payload.toolUseId
                    : undefined;
                const isError = payload.isError === true;
                writeMessages((prev) => {
                  const copy = [...prev];
                  const idx = copy.findIndex(
                    (m) => m.role === "assistant" && m.isLoading,
                  );
                  if (idx < 0) return copy;
                  const existing = copy[idx].toolCalls ?? [];
                  let target = -1;
                  if (toolUseId)
                    target = existing.findIndex((tc) => tc.id === toolUseId);
                  if (target < 0) {
                    for (let i = existing.length - 1; i >= 0; i--) {
                      if (existing[i].status === "running") {
                        target = i;
                        break;
                      }
                    }
                  }
                  if (target < 0) return copy;
                  const next = existing.slice();
                  next[target] = {
                    ...next[target],
                    status: isError ? "error" : "success",
                  };
                  copy[idx] = { ...copy[idx], toolCalls: next };
                  return copy;
                });
              } else {
                // phase === "use" (or absent — older payloads default to use)
                const toolName =
                  typeof payload.name === "string" ? payload.name : "tool";
                const toolInput = (payload.input ?? {}) as Record<
                  string,
                  unknown
                >;
                const toolId =
                  typeof payload.id === "string" ? payload.id : undefined;
                writeMessages((prev) => {
                  const copy = [...prev];
                  let idx = copy.findIndex(
                    (m) => m.role === "assistant" && m.isLoading,
                  );
                  if (idx < 0) {
                    copy.push({
                      role: "assistant",
                      content: "",
                      timestamp: new Date().toISOString(),
                      isLoading: true,
                      toolCalls: [],
                    });
                    idx = copy.length - 1;
                  }
                  const existing = copy[idx].toolCalls ?? [];
                  copy[idx] = {
                    ...copy[idx],
                    toolCalls: [
                      ...existing,
                      {
                        id: toolId,
                        name: toolName,
                        arguments: toolInput,
                        status: "running",
                      },
                    ],
                  };
                  return copy;
                });
              }
              break;
            }
          }
        }
      },
    [dispatchLive, setLoading],
  );

  const startInteractivePoll = useCallback(
    (sessionId: string, uiSessionId?: string | null) => {
      stopInteractivePoll();
      const writeMessages = (updater: MessagesUpdater) => {
        if (uiSessionId) setMessagesForSession(uiSessionId, updater);
        else setMessages(updater);
      };

      const transport = getChatLiveTransport();
      if (!transport) {
        dispatchLive({
          type: "RUNNER_ERROR",
          errorMessage: MISSING_LIVE_TRANSPORT_MESSAGE,
        });
        reportMissingTransport(writeMessages);
        return;
      }

      const handleEvents = buildEventHandler(
        writeMessages,
        stopInteractivePoll,
      );
      liveTransportUnsubRef.current = transport.subscribe(
        sessionId,
        (event) => handleEvents([event]),
      );
    },
    [
      buildEventHandler,
      reportMissingTransport,
      dispatchLive,
      setMessages,
      setMessagesForSession,
      stopInteractivePoll,
    ],
  );

  // ─── Scoped live subscription (task / capability chats) ────────────────────

  const connectSSE = useCallback(
    (
      sessionId: string,
      opts: { interactive?: boolean; uiSessionId?: string | null } = {},
    ) => {
      // Close any existing scoped subscription before opening a new one.
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      const writeMessages = (updater: MessagesUpdater) => {
        if (opts.uiSessionId) setMessagesForSession(opts.uiSessionId, updater);
        else setMessages(updater);
      };

      const transport = getChatLiveTransport();
      if (!transport) {
        reportMissingTransport(writeMessages);
        return;
      }

      const close = () => {
        unsub();
        if (eventSourceRef.current === handle) eventSourceRef.current = null;
      };
      const handle = { close };
      const handleEvents = buildEventHandler(writeMessages, close);
      const unsub = transport.subscribe(sessionId, (event) =>
        handleEvents([event]),
      );
      eventSourceRef.current = handle;
    },
    [
      buildEventHandler,
      reportMissingTransport,
      setMessages,
      setMessagesForSession,
    ],
  );

  // Open the scoped live subscription whenever we have a scoped session id —
  // task id for task mode, `capability-{slug}` for capability mode.
  // Global-mode subscriptions are opened on demand inside the send path.
  //
  // Tab-visibility gate: background tabs don't need a live subscription;
  // close it on `visibilityState=hidden`, reopen on `visible`. Loss of
  // in-flight events is acceptable — chat history is hydrated from
  // useChatSessions (the global session store) on next view.
  useEffect(() => {
    const sid =
      selectedTaskId ??
      (capabilitySlug != null ? `capability-${capabilitySlug}` : null) ??
      null;
    if (!sid) {
      return () => {
        eventSourceRef.current?.close();
      };
    }

    const open = () => {
      if (eventSourceRef.current) return;
      connectSSE(sid, { uiSessionId: activeSessionIdForReset });
    };
    const close = () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") open();
      else close();
    };

    if (document.visibilityState === "visible") open();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      close();
    };
  }, [selectedTaskId, capabilitySlug, connectSSE, activeSessionIdForReset]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Kody Live: warm-up the long-lived runner. Wires the dispatch + SSE
  // for an interactive session. Chat input stays disabled until the runner
  // emits chat.ready (handled in connectSSE).
  const startInteractiveSession = useCallback(
    async (opts?: LiveSessionStartOptions) => {
      const cur = liveStateRef.current.phase;
      if (cur === "booting" || cur === "ready" || cur === "awaiting") return;

      // Embed the scope key in the sessionId so kody.yml's concurrency
      // group (`kody-${sessionId}`) puts each issue in its own bucket.
      // Two vibe issues now boot independent runners.
      const scopeKey = currentScopeKeyRef.current;
      const sessionId = `${scopeKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();
      dispatchLive({ type: "START", sessionId, scopeKey, startedAt });

      try {
        // dashboardUrl re-enabled — engine pushes events to /ingest in
        // real time so chat replies don't wait for the 3s file-poll. Auth
        // on /ingest is GitHub Actions IP verification (no shared secret).
        const dashboardUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/api/kody/events/ingest`
            : undefined;
        // Route to Fly Machines spawner when the user picked the kody-live-fly
        // agent — same engine + same session JSONL, different runtime.
        const isFlyRoute = selectedAgentId === "kody-live-fly";
        const startEndpoint = isFlyRoute
          ? "/api/kody/chat/interactive/start-fly"
          : "/api/kody/chat/interactive/start";
        // Fly token now lives in the repo vault (project-scoped) and is read
        // by the start-fly route directly — no header needed. Perf tier
        // stays per-user in localStorage and is sent as a header.
        const flyHeader: Record<string, string> = {};
        if (isFlyRoute) {
          const flyPerf = getStoredFlyPerf();
          if (flyPerf) flyHeader["x-kody-fly-perf"] = flyPerf;
        }
        const startRes = await fetch(startEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
            ...flyHeader,
          },
          body: JSON.stringify({
            taskId: sessionId,
            dashboardUrl,
            idleExitMs: 5 * 60_000,
            hardCapMs: 30 * 60_000,
            // Forward the chat-level thinking pick so the engine's
            // extended-thinking budget matches the chat's reasoning
            // dropdown. Empty when the user is on Live (no chat-level
            // pick) — engine falls back to its own default.
            ...(effectiveReasoningEffort
              ? { reasoningEffort: effectiveReasoningEffort }
              : {}),
            // First turn folded into the session-create commit (atomic) so the
            // runner sees it on first read — no racy follow-up append.
            ...(opts?.initialContent
              ? {
                  content: opts.initialContent,
                  timestamp: opts.initialTimestamp,
                  ...vibeTurnFields(vibeMode, opts.taskContext),
                }
              : {}),
          }),
        });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${startRes.status}`);
        }
        const startBody = (await startRes.json().catch(() => ({}))) as {
          target?: { owner: string; repo: string };
        };
        if (startBody.target) {
          // Reducer's persistence useEffect will re-save the record with the
          // resolved target so a refresh during boot still shows the link.
          dispatchLive({ type: "TARGET_RESOLVED", target: startBody.target });
        }
        startInteractivePoll(
          sessionId,
          opts?.uiSessionId ?? activeSessionIdForReset,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        dispatchLive({ type: "START_FAILED", errorMessage });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Failed to start live runner: ${errorMessage}`,
            isLoading: false,
          },
        ]);
      }
    },
    // Dependency list intentionally matches the pre-extraction KodyChat
    // callback exactly (effectiveReasoningEffort was read from the render
    // closure there too) — behavior-identical is the contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      setMessages,
      selectedAgentId,
      startInteractivePoll,
      dispatchLive,
      vibeMode,
      activeSessionIdForReset,
    ],
  );

  // Cancel a Kody Live session locally. Closes the SSE, clears the saved
  // record for the CURRENT scope, and flips state to 'idle' so the user
  // can start a fresh one. Does NOT cancel the GitHub Actions run — the
  // runner idle-exits on its own (default 5min) so leaving it alone is cheap.
  const endInteractiveSession = useCallback(() => {
    stopInteractivePoll();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    dispatchLive({ type: "END" });
  }, [stopInteractivePoll, dispatchLive]);

  // Force a clean restart of the live session — used by the "Runner stuck —
  // restart?" affordance. Tears down poll + SSE, resets the reducer, then
  // kicks off a fresh /start.
  const restartInteractiveSession = useCallback(
    async (opts?: LiveSessionStartOptions) => {
      stopInteractivePoll();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      dispatchLive({ type: "FORCE_RESET" });
      // Defer to next tick so the reducer's persistence effect can clear the
      // stale localStorage record before /start writes a new one.
      await Promise.resolve();
      await startInteractiveSession(opts);
    },
    [stopInteractivePoll, dispatchLive, startInteractiveSession],
  );

  // ── Scope tracking ───────────────────────────────────────────────────
  // Each chat scope (Vibe issue vs global) has its own live session. When
  // the user switches issues, swap the in-view session: close the old
  // SSE, then either rehydrate the new scope's saved record or reset to
  // idle. Runners for off-screen scopes keep running in GHA and will
  // self-exit on idle.
  const rehydrateForScope = useCallback(
    (scopeKey: LiveScopeKey) => {
      const saved = loadLiveSession(scopeKey);
      // Close any prior SSE before swapping refs so old events don't
      // race the new state.
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      stopInteractivePoll();
      // Record ↔ action mapping (REHYDRATE_IDLE vs REHYDRATE_RESTORED,
      // incl. bootStartedAt only while booting) is pure logic in
      // chat/core/rehydration.ts.
      if (!saved) {
        dispatchLive(buildRehydrateAction(scopeKey, null));
        return;
      }
      dispatchLive(buildRehydrateAction(scopeKey, saved));
      startInteractivePoll(saved.sessionId);
    },
    [startInteractivePoll, stopInteractivePoll, dispatchLive],
  );

  useEffect(() => {
    const nextScope = getLiveScopeKey(context, vibeMode);
    // Duplicate-rehydrate suppression lives in chat/core/rehydration.ts:
    // same scope + restore already attempted → no-op.
    if (
      !shouldRehydrateScope(
        nextScope,
        currentScopeKeyRef.current,
        liveRestoreAttemptedRef.current,
      )
    ) {
      return;
    }
    currentScopeKeyRef.current = nextScope;
    liveRestoreAttemptedRef.current = true;
    rehydrateForScope(nextScope);
  }, [context, vibeMode, rehydrateForScope]);

  // ── Watchdog ─────────────────────────────────────────────────────────
  // The runner is supposed to drive its own lifecycle (chat.ready → ...
  // → chat.exit). Sometimes it dies silently — GHA cancellation, network
  // partition, OOM — and the dashboard is left believing it's still alive.
  // When that happens the UI shows "Kody Live is thinking…" forever.
  //
  // The watchdog re-anchors the UI to server truth. If we've been in a
  // waiting phase (booting/awaiting) without a new event for too long, we
  // ask /api/kody/chat/session/[id]/status what the events file says, and
  // dispatch STATUS_RESULT. The reducer downgrades to 'stuck' if the
  // server confirms the runner is gone — at which point the banner
  // surfaces a Restart button.
  //
  // Thresholds: booting takes ~90s on GHA cold start, ~45s on Fly; allow
  // 150s before suspecting. A turn can take 2-3 min for complex work;
  // allow 240s after the last event before suspecting.
  const watchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (watchdogTimeoutRef.current) {
      clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
    if (!isWatchdogActive(liveState.phase) || !liveState.sessionId) return;

    const sessionId = liveState.sessionId;
    const since =
      liveState.lastEventAt ?? liveState.bootStartedAt ?? Date.now();
    const deadlineMs = liveState.phase === "booting" ? 150_000 : 240_000;
    const remainingMs = Math.max(5_000, deadlineMs - (Date.now() - since));

    watchdogTimeoutRef.current = setTimeout(() => {
      // Re-read the source of truth — the reducer may have advanced
      // between scheduling and firing (a new event reset lastEventAt).
      const cur = liveStateRef.current;
      if (!cur.sessionId || cur.sessionId !== sessionId) return;
      if (!isWatchdogActive(cur.phase)) return;
      const ageMs =
        Date.now() - (cur.lastEventAt ?? cur.bootStartedAt ?? Date.now());
      const phaseDeadline = cur.phase === "booting" ? 150_000 : 240_000;
      if (ageMs < phaseDeadline) return; // false alarm — reschedule via next render

      const params = new URLSearchParams();
      const auth = liveAuthFor(sessionId);
      if (auth) {
        params.set("owner", auth.owner);
        params.set("repo", auth.repo);
        params.set("token", auth.token);
      }
      // Pass our local lastEventAt so the server can detect the
      // "engine pushed events via real-time HTTP but never committed
      // them to the file" zombie case.
      const localLast = cur.lastEventAt ?? cur.bootStartedAt ?? null;
      if (localLast !== null) {
        params.set("clientLastEventAt", String(localLast));
      }
      // An inconclusive probe (status fetch failed, non-ok, or "alive" with
      // still no events reaching the client) consumes one unit of the probe
      // budget. Exhausting the budget force-marks the session stuck; short
      // of that, re-arm the watchdog via STATUS_RESULT — without the bump a
      // cleared timer with unchanged deps would never probe again, ending
      // watchdog coverage for the session.
      const recordInconclusiveProbe = () => {
        watchdogProbesRef.current += 1;
        if (watchdogProbesRef.current >= WATCHDOG_MAX_INCONCLUSIVE_PROBES) {
          dispatchLive({
            type: "MARK_STUCK",
            errorMessage:
              "No runner events for several minutes and the status check can't confirm the runner is alive. Restart the session to continue.",
          });
          return;
        }
        dispatchLive({
          type: "STATUS_RESULT",
          runnerAlive: true,
          lastEventAt: null,
        });
      };
      fetch(
        `/api/kody/chat/session/${encodeURIComponent(sessionId)}/status${params.size ? `?${params}` : ""}`,
        { headers: { ...liveAuthHeaders(sessionId) } },
      )
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            body: {
              runnerAlive?: boolean;
              lastEventAt?: number | null;
              reason?: string | null;
            } | null,
          ) => {
            if (!body) {
              recordInconclusiveProbe();
              return;
            }
            if (body.runnerAlive) {
              recordInconclusiveProbe();
              return;
            }
            // The reducer guards against a stale dispatch — only flips to
            // 'stuck' if it's still in an active phase when STATUS_RESULT
            // arrives.
            dispatchLive({
              type: "STATUS_RESULT",
              runnerAlive: false,
              lastEventAt: body.lastEventAt ?? null,
              errorMessage: body.reason ?? undefined,
            });
          },
        )
        .catch(() => {
          // Network failure: don't assume zombie yet — count it against the
          // probe budget so a persistently unreachable status endpoint
          // (e.g. expired live-auth token) still resolves to 'stuck'.
          recordInconclusiveProbe();
        });
    }, remainingMs);

    return () => {
      if (watchdogTimeoutRef.current) {
        clearTimeout(watchdogTimeoutRef.current);
        watchdogTimeoutRef.current = null;
      }
    };
  }, [
    liveState.phase,
    liveState.sessionId,
    liveState.lastEventAt,
    liveState.bootStartedAt,
    dispatchLive,
  ]);

  return {
    liveState,
    liveStateRef,
    dispatchLive,
    interactiveSessionIdRef,
    interactiveStateRef,
    interactiveTargetRef,
    currentScopeKeyRef,
    bootElapsed,
    eventSourceRef,
    connectSSE,
    startInteractivePoll,
    stopInteractivePoll,
    startInteractiveSession,
    endInteractiveSession,
    restartInteractiveSession,
    rehydrateForScope,
  };
}
