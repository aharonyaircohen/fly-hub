/**
 * @fileType module
 * @domain kody
 * @pattern kody-chat-send-pipeline
 * @ai-summary The send orchestration extracted from KodyChat (phase
 *   1.6b): `runSendText` sends turns to Hermes and `runSendMessage`
 *   owns the composer submit path
 *   (/init, plugin send-middleware, waiting-instruction route). Behavior
 *   is identical to the pre-extraction inline code — component state is
 *   injected via the explicit `SendTextDeps` / `SendMessageDeps` objects
 *   built fresh by KodyChat's thin useCallback wrappers, so staleness
 *   semantics (the wrapper's dependency array) are unchanged.
 *
 *   Settle seam (review item 11): every backend's finish/recover
 *   behavior is declared in SETTLE_STRATEGIES / FINISH_STRATEGIES and
 *   applied through ONE pair of functions — `settleDecision` (pure,
 *   unit-tested) + `applySettleDecision` — instead of four interleaved
 *   catch blocks. The strategy table is data: brain aborts pop the
 *   optimistic slice, kody-direct aborts settle the bubble in place,
 *   kody-live surfaces fire-and-ack failures as error bubbles, and the
 *   engine trigger mirrors brain. Errors are uniform error bubbles.
 *
 *   Placement note: this module lives in components/ (not chat/core)
 *   because it necessarily imports the components-zone Message type,
 *   the live-runner hook types, and plugin turn-context helpers — all
 *   forbidden imports for chat/core under the layer zones in
 *   eslint.config.mjs (same placement rationale as
 *   kody-chat-live-runner.ts).
 */
"use client";

import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { type AgentId } from "../agents";
import type { ChatDropdownEntry } from "../chat/platform/agent-entries";
import {
  trace,
  type createChatPluginRegistry,
} from "../chat/platform";
import type { KodyTask } from "@kody-ade/base/types";
import { authHeaders } from "../kody-chat-live-session";
import {
  KodyDirectConnectionDroppedError,
} from "../chat/core/transports/kody-direct";
import { ChatTurnStalledError } from "../chat/core/transports/turn-coordinator";
import type { TransportTurnState } from "./kody-chat-transport-events";
import {
  type Message,
  type ToolCall,
  type Attachment,
  type KodyChatProps,
} from "./kody-chat-types";
import type { ChatContext, MachineAccess } from "../chat-types";
import type { useConversationSessions } from "../chat/core/conversation/use-conversation-sessions";
import { consumeHermesStream } from "../chat/core/transports/hermes-stream";
import type { useLiveRunner } from "./kody-chat-live-runner";
import { parseReasoning, stripReasoning } from "../chat/core/reasoning";
import { SILENT_ASSISTANT_NOTICE } from "../chat/core/silent-turn";
import type { StaffMentionTrigger } from "../mentions/agent-mentions";
import type { RecentVibeIssue } from "../chat/plugins/vibe";
import type { TerminalIntentEffectPayload } from "../chat/plugins/terminal/intent-middleware";
import type { ChatTerminalMode } from "../chat/plugins/terminal/types";
import type { SlashExpansionEffectPayload } from "../chat/plugins/commands";
import type {
  DashboardNavigateDirective,
  PreviewActDirective,
} from "../chat-ui-actions";
import { SHOW_VIEW_TOOL } from "../chat-output-tools";
import type { CompactionStatus } from "./kody-chat-compaction";
import {
  completeActiveAssistant,
  removeActiveAssistant,
  replaceActiveAssistantWithError,
  updateActiveAssistant,
} from "./kody-chat-turn-surface";

// ─────────────────────────────────────────────────────────────────────
// Settle seam (review item 11). Per-backend finish/recover behavior is
// DECLARED here as data; the branches below apply it through one pair
// of functions instead of four hand-rolled catch blocks.
// ─────────────────────────────────────────────────────────────────────

export type SettleBackend =
  "brain" | "kody-direct" | "kody-live" | "kody-engine";

/** Maximum silence between Kody Direct transport events. */
export const KODY_DIRECT_INACTIVITY_MS = 120_000;

/**
 * Maximum silence between Brain transport events. Longer than kody-direct
 * because a cold Fly boot legitimately produces no events for ~100s and the
 * Vercel proxy may hold the first connection up to its 300s ceiling before
 * handing back. Set just above that ceiling: any single silent connection is
 * ended by the proxy first (EOF → the adapter's resume loop reconnects and
 * replays events), so this deadline only fires when reconnect cycles
 * themselves stay silent — i.e. the turn is genuinely dead and the UI would
 * otherwise show "thinking" forever.
 */
export const BRAIN_INACTIVITY_MS = 330_000;

/** Classified turn failure: Stop-button abort vs a real error. */
export type TurnFailure =
  { kind: "abort"; message: string } | { kind: "error"; message: string };

/** How the in-flight assistant bubble resolves. */
export type SettleMessageOp = "pop-last" | "unmark-loading" | "error-bubble";

export interface SettleDecision {
  messageOp: SettleMessageOp;
  /** Whether the typing indicator is cleared as part of the settle. */
  stopLoading: boolean;
  /** Present iff messageOp === "error-bubble". */
  errorMessage?: string;
}

/**
 * The per-backend recover table. Errors are uniform (error bubble);
 * only the ABORT (Stop button) behavior differs per backend:
 *  - brain: pop the optimistic assistant slice (historical behavior —
 *    the typing indicator is left to the reconnect/done machinery).
 *  - kody-direct: settle the in-flight bubble in place (keep streamed
 *    partial text) and clear the typing state.
 *  - kody-live: fire-and-ack append has no abort path — an AbortError
 *    reaching its catch surfaces like any other failure.
 *  - kody-engine: mirrors brain (pop the optimistic slice).
 */
export const SETTLE_STRATEGIES: Record<
  SettleBackend,
  { abort: { messageOp: SettleMessageOp; stopLoading: boolean } }
> = {
  brain: { abort: { messageOp: "pop-last", stopLoading: false } },
  "kody-direct": { abort: { messageOp: "unmark-loading", stopLoading: true } },
  "kody-live": { abort: { messageOp: "error-bubble", stopLoading: true } },
  "kody-engine": { abort: { messageOp: "pop-last", stopLoading: false } },
};

/**
 * The per-backend finish table (documentation-as-data): what happens
 * after a transport send() resolves without throwing.
 *  - brain: clear typing + unmark every loading bubble (applyBrainFinish).
 *  - kody-direct: the empty-turn fallback + display override + deferred
 *    directive application (finalizeKodyDirectTurn).
 *  - kody-live / kody-engine: fire-and-ack — the reply arrives through
 *    the runner event stream, so there is nothing to settle here.
 */
export const FINISH_STRATEGIES: Record<
  SettleBackend,
  "unmark-all" | "direct-finalize" | "none"
> = {
  brain: "unmark-all",
  "kody-direct": "direct-finalize",
  "kody-live": "none",
  "kody-engine": "none",
};

export function classifyTurnFailure(err: unknown): TurnFailure {
  const isAbort =
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError");
  const message = err instanceof Error ? err.message : "Unknown error";
  return isAbort ? { kind: "abort", message } : { kind: "error", message };
}

export function shouldPreservePendingDirectTurn(
  visibilityState: DocumentVisibilityState | undefined,
): boolean {
  return visibilityState === "hidden";
}

export function shouldRecoverDurableDirectTurn(error: unknown): boolean {
  return (
    error instanceof KodyDirectConnectionDroppedError ||
    error instanceof ChatTurnStalledError
  );
}

/** Pure decision: (backend, failure) → how the turn settles. */
export function settleDecision(
  backend: SettleBackend,
  failure: TurnFailure,
): SettleDecision {
  if (failure.kind === "error") {
    return {
      messageOp: "error-bubble",
      stopLoading: true,
      errorMessage: failure.message,
    };
  }
  const abort = SETTLE_STRATEGIES[backend].abort;
  return abort.messageOp === "error-bubble"
    ? { ...abort, errorMessage: failure.message }
    : { ...abort };
}

interface SettleIO {
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setLoading: (loading: boolean) => void;
}

/** Apply a settle decision to the UI — the ONE recover implementation. */
export function applySettleDecision(
  decision: SettleDecision,
  io: SettleIO,
): void {
  if (decision.stopLoading) io.setLoading(false);
  switch (decision.messageOp) {
    case "pop-last":
      io.setMessages(removeActiveAssistant);
      return;
    case "unmark-loading":
      io.setMessages(completeActiveAssistant);
      return;
    case "error-bubble":
      io.setMessages((prev) =>
        replaceActiveAssistantWithError(
          prev,
          `Error: ${decision.errorMessage}\n\nWould you like me to try again?`,
        ),
      );
      return;
  }
}

/**
 * Kody-direct finish: mark not loading. If the turn produced NOTHING
 * visible (no answer text, no reasoning, no tool calls) and is not
 * handing off to a runner, surface a note instead of leaving a silent
 * blank bubble — the user must always get feedback. A trailing tool
 * error with no answer surfaces as the error.
 */
export function finalizeKodyDirectTurn(params: {
  io: SettleIO;
  turn: TransportTurnState;
  assistantDisplayOverride: string | null | void;
}): void {
  const { io, turn, assistantDisplayOverride } = params;
  const {
    lastToolErrorText,
    lastToolErrorToolName,
    pendingSwitchAgent,
    pendingDashboardNavigate,
    pendingView,
  } = turn;
  io.setMessages((prev) =>
    updateActiveAssistant(prev, (m) => {
      const { reasoning, answer } = parseReasoning(m.content ?? "");
      const hadSuccessfulTools = (m.toolCalls ?? []).some(
        (tc) => tc.status === "success" && tc.activityKind !== "subagent",
      );
      const shouldSurfaceToolError =
        !!lastToolErrorText &&
        !pendingSwitchAgent &&
        !pendingDashboardNavigate &&
        !pendingView &&
        (!answer.trim() || lastToolErrorToolName === SHOW_VIEW_TOOL);
      // Reasoning alone is NOT a response — a turn that only "thought"
      // must still surface the no-response note (the thought panel is
      // kept above it), or the user gets a silent collapsed bubble.
      const producedNothing =
        !answer.trim() &&
        !hadSuccessfulTools &&
        !pendingSwitchAgent &&
        !pendingDashboardNavigate &&
        !pendingView;
      return shouldSurfaceToolError
        ? {
            ...m,
            isLoading: false,
            isError: true,
            content: `Error: ${lastToolErrorText}`,
          }
        : producedNothing
          ? {
              ...m,
              isLoading: false,
              isError: true,
              content: `${reasoning.trim() ? `<think>${reasoning}</think>\n\n` : ""}${SILENT_ASSISTANT_NOTICE}`,
            }
          : {
              ...m,
              ...(typeof assistantDisplayOverride === "string"
                ? { content: assistantDisplayOverride }
                : {}),
              isLoading: false,
            };
    }),
  );
  io.setLoading(false);
}

// ─────────────────────────────────────────────────────────────────────
// Pipeline dependency surfaces. Built fresh inside KodyChat's thin
// wrappers so staleness semantics match the pre-extraction closures.
// ─────────────────────────────────────────────────────────────────────

type SessionHook = ReturnType<typeof useConversationSessions>;
type LiveRunner = ReturnType<typeof useLiveRunner>;
type PluginRegistry = ReturnType<typeof createChatPluginRegistry>;
type MiddlewareContext = Parameters<PluginRegistry["runSendMiddleware"]>[1];
type MessagesUpdater = Message[] | ((prev: Message[]) => Message[]);

export interface SendTextOptions {
  voiceMode?: boolean;
  hidden?: boolean;
  forceAgentId?: AgentId;
  onVoiceDelta?: (spokenSoFar: string) => void;
  onAssistantTextComplete?: (assistantText: string) => string | null | void;
  /**
   * Override the text that goes into the user bubble. Defaults to
   * `messageContent` — set this when the model should see something
   * different from what the user sees (e.g. an expanded slash-command
   * prompt: the model gets the expanded body, the bubble shows only
   * what the user typed).
   */
  displayContent?: string;
  /** Failed assessment turn whose saved specialist packet should be rewritten. */
  retryAssessmentTurnId?: string;
}

export interface SendTextDeps {
  // Selection / scope state
  selectedAgentId: AgentId;
  selectedModelId: string | null;
  effectiveReasoningEffort: string | null;
  selectedMachineAccess: MachineAccess;
  selectedTask: KodyTask | null;
  capabilitySlug: string | null;
  selectedCapability:
    Extract<ChatContext, { kind: "capability" }>["capability"] | null;
  selectedOrg: Extract<ChatContext, { kind: "org" }> | null;
  selectedReport: Extract<ChatContext, { kind: "report" }>["report"] | null;
  selectedApp: Extract<ChatContext, { kind: "app" }>["app"] | null;
  onIssueCreated: KodyChatProps["onIssueCreated"];
  onRenderedViewInvalidate?: never;
  vibeMode: KodyChatProps["vibeMode"];
  context: KodyChatProps["context"];
  actorLogin: KodyChatProps["actorLogin"];
  repoAgentSlugs: string[];
  selectedAgencyAgentSlug: string;
  agentList: ChatDropdownEntry[];
  lockedAgentSlug?: string;
  kodyDirectHeaders?: Record<string, string>;
  // Session store
  sessionHook: SessionHook;
  messages: Message[];
  setMessagesForSession: (
    sessionId: string,
    updater: MessagesUpdater,
    options?: { persist?: boolean },
  ) => void;
  setLoading: (loading: boolean) => void;
  setToolCalls: (toolCalls: ToolCall[]) => void;
  selectAgentEntry: (entry: ChatDropdownEntry) => void;
  setVoiceOverlayOpen: (open: boolean) => void;
  setCompactionStatus: (status: CompactionStatus) => void;
  // Refs (read at send time)
  currentPageRef: MutableRefObject<string | null>;
  collectPreviewContextRef: MutableRefObject<() => Promise<string | null>>;
  recentVibeIssueRef: MutableRefObject<RecentVibeIssue | null>;
  brainAbortRef: MutableRefObject<AbortController | null>;
  brainAbortBySessionRef: MutableRefObject<Map<string, AbortController>>;
  kodyAbortRef: MutableRefObject<AbortController | null>;
  kodyAbortBySessionRef: MutableRefObject<Map<string, AbortController>>;
  // Live runner surface
  interactiveStateRef: LiveRunner["interactiveStateRef"];
  interactiveSessionIdRef: LiveRunner["interactiveSessionIdRef"];
  startInteractiveSession: LiveRunner["startInteractiveSession"];
  restartInteractiveSession: LiveRunner["restartInteractiveSession"];
  dispatchLive: LiveRunner["dispatchLive"];
  connectSSE: LiveRunner["connectSSE"];
  // Directive appliers
  runPreviewActionFromDirective: (
    directive: PreviewActDirective,
  ) => Promise<void>;
  runDashboardNavigateFromDirective: (
    directive: DashboardNavigateDirective,
  ) => void;
}

export type SendTextFn = (
  messageContent: string,
  currentAttachments?: Attachment[],
  options?: SendTextOptions,
) => Promise<string | null>;

export async function runSendText(
  deps: SendTextDeps,
  messageContent: string,
  currentAttachments: Attachment[] = [],
  options: SendTextOptions = {},
): Promise<string | null> {
  // Client trace (phase 2 step 2): start/settle markers around the whole
  // turn pipeline. Behavior-neutral — trace never throws, never logs.
  // The empty-message guard below returns before any transport work, so
  // mirror it here to avoid tracing no-op sends.
  const traceAgentId = options.forceAgentId ?? deps.selectedAgentId;
  const shouldTrace =
    Boolean(messageContent.trim()) || currentAttachments.length > 0;
  if (shouldTrace) {
    trace({ kind: "transport:send-start", detail: { agentId: traceAgentId } });
  }
  try {
    return await runSendTextInner(
      deps,
      messageContent,
      currentAttachments,
      options,
    );
  } finally {
    if (shouldTrace) {
      trace({
        kind: "transport:send-settle",
        detail: { agentId: traceAgentId },
      });
    }
  }
}

async function runSendTextInner(
  deps: SendTextDeps,
  messageContent: string,
  currentAttachments: Attachment[] = [],
  options: SendTextOptions = {},
): Promise<string | null> {
  const {
    selectedModelId,
    effectiveReasoningEffort,
    selectedMachineAccess,
    selectedTask,
    selectedCapability,
    vibeMode,
    agentList,
    sessionHook,
    setMessagesForSession,
    setLoading,
    setToolCalls,
    kodyDirectHeaders,
    currentPageRef,
    kodyAbortRef,
    kodyAbortBySessionRef,
  } = deps;
  if (!messageContent.trim() && currentAttachments.length === 0) return null;

  const selectedEntryKey = agentList.find(
    (entry) => entry.agentId === deps.selectedAgentId && (entry.modelId ?? null) === selectedModelId,
  )?.key;
  const sessionId = sessionHook.activeSession?.id ?? sessionHook.createSession({
    ...(selectedEntryKey ? { agentKey: selectedEntryKey } : {}),
    machineAccess: selectedMachineAccess,
  });
  const setLocalMessages = (updater: MessagesUpdater) => {
    setMessagesForSession(sessionId, (previous) => {
      return typeof updater === "function" ? updater(previous) : updater;
    }, { persist: false });
  };

  const messageId = crypto.randomUUID();
  const displayContent = options.displayContent ?? messageContent;
  setLocalMessages((previous) => [
    ...previous,
    {
      id: messageId,
      role: "user",
      content: displayContent,
      timestamp: new Date().toISOString(),
      ...(currentAttachments.length ? {
        attachments: currentAttachments.map((file) => ({
          id: file.id, name: file.name, mimeType: file.mimeType, size: file.size,
        })),
      } : {}),
      ...(options.hidden ? { hidden: true } : {}),
    },
    {
      id: `assistant:${messageId}`,
      turnId: messageId,
      role: "assistant",
      content: "",
      isLoading: true,
      timestamp: new Date().toISOString(),
    },
  ]);
  setLoading(true);
  setToolCalls([]);

  kodyAbortBySessionRef.current.get(sessionId)?.abort();
  const abort = new AbortController();
  kodyAbortBySessionRef.current.set(sessionId, abort);
  kodyAbortRef.current = abort;
  const headers = { ...authHeaders(), ...kodyDirectHeaders };
  const source = vibeMode ? "kody-vibe-default" : "kody-global";
  const fileRefs: string[] = [];
  const images: Array<{ name: string; dataUrl: string }> = [];
  let answer = "";
  const toolCalls: ToolCall[] = [];
  const updateAssistant = (change: (message: Message) => Message) => {
    setLocalMessages((previous) => previous.map((message) =>
      message.id === `assistant:${messageId}` ? change(message) : message,
    ));
  };
  const voiceDelta = options.voiceMode && options.onVoiceDelta
    ? (text: string) => options.onVoiceDelta!(stripReasoning(text))
    : undefined;

  try {
    const hermesSessionId = await sessionHook.resolveSessionId(sessionId);
    const runtimeSessionId = await sessionHook.resolveRuntimeSessionId(sessionId);
    for (const attachment of currentAttachments) {
      if (attachment.mimeType.startsWith("image/")) {
        images.push({ name: attachment.name, dataUrl: attachment.data });
        continue;
      }
      const response = await fetch(
        `/api/kody/hermes/sessions/${encodeURIComponent(hermesSessionId)}/attachments`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ name: attachment.name, dataUrl: attachment.data, runtimeSessionId }),
          signal: abort.signal,
        },
      );
      const result = await response.json().catch(() => null) as { ref_text?: unknown; error?: unknown } | null;
      if (!response.ok || typeof result?.ref_text !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Hermes could not attach that file.");
      }
      fileRefs.push(result.ref_text);
    }

    const text = [messageContent || (images.length ? "Please describe the attached image." : ""), ...fileRefs]
      .filter(Boolean).join("\n\n");
    const context = [
      currentPageRef.current ? `Current dashboard page: ${currentPageRef.current}` : "",
      selectedTask ? `Current task: ${selectedTask.title} (#${selectedTask.issueNumber})` : "",
      selectedCapability ? `Current capability: ${selectedCapability.title}` : "",
    ].filter(Boolean).join("\n");
    const response = await fetch(
      `/api/kody/hermes/sessions/${encodeURIComponent(hermesSessionId)}/chat/stream`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          images,
          runtimeSessionId,
          source,
          ...(selectedModelId ? { model: selectedModelId } : {}),
          ...(effectiveReasoningEffort ? { model_options: { reasoning_effort: effectiveReasoningEffort } } : {}),
          ...(context ? { system_message: context } : {}),
        }),
        signal: abort.signal,
      },
    );
    if (!response.ok || !response.body) {
      const result = await response.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof result?.error === "string" ? result.error : `Hermes request failed (${response.status}).`);
    }

    let streamError: string | null = null;
    await consumeHermesStream(response.body, ({ type, payload }) => {
      if (type === "assistant.delta" && typeof payload.delta === "string") {
        answer += payload.delta;
        updateAssistant((message) => ({ ...message, content: answer }));
        voiceDelta?.(answer);
      } else if (type === "assistant.completed") {
        const completed = payload.content ?? payload.text;
        if (typeof completed === "string") {
          answer = completed;
          updateAssistant((message) => ({ ...message, content: answer }));
        }
      } else if (type === "session.title" && typeof payload.title === "string") {
        sessionHook.renameSession(sessionId, payload.title);
      } else if (type === "tool.started" || type === "tool.start") {
        toolCalls.push({
          name: String(payload.tool_name ?? payload.name ?? "tool"),
          arguments: (payload.args && typeof payload.args === "object" ? payload.args : {}) as Record<string, unknown>,
          status: "running",
          startedAt: Date.now(),
          description: typeof payload.preview === "string" ? payload.preview : undefined,
        });
        setToolCalls([...toolCalls]);
        updateAssistant((message) => ({ ...message, toolCalls: toolCalls.map((call) => ({ ...call })) }));
      } else if (type === "tool.complete" || type === "tool.completed" || type === "tool.failed") {
        const name = String(payload.tool_name ?? payload.name ?? "");
        const call = [...toolCalls].reverse().find((item) => item.name === name && item.status === "running");
        if (call) {
          call.status = type === "tool.failed" ? "error" : "success";
          call.result = payload.result ?? payload.summary ?? payload.result_text;
          if (typeof payload.duration_s === "number") call.durationMs = payload.duration_s * 1_000;
          setToolCalls([...toolCalls]);
          updateAssistant((message) => ({ ...message, toolCalls: toolCalls.map((item) => ({ ...item })) }));
        }
      } else if (type === "error" || type === "run.failed") {
        streamError = typeof payload.message === "string" ? payload.message : "Hermes could not finish this reply.";
      }
    });
    if (streamError) throw new Error(streamError);

    let displayOverride: string | null | void;
    try {
      displayOverride = options.onAssistantTextComplete?.(answer.trim());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not finish this action.");
    }
    updateAssistant((message) => ({
      ...message,
      content: typeof displayOverride === "string" ? displayOverride : answer,
      isLoading: false,
    }));
    setLoading(false);
    return answer || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hermes could not finish this reply.";
    updateAssistant((item) => abort.signal.aborted
      ? { ...item, isLoading: false }
      : { ...item, content: `Error: ${message}`, isError: true, isLoading: false });
    setLoading(false);
    return null;
  } finally {
    if (kodyAbortBySessionRef.current.get(sessionId) === abort) kodyAbortBySessionRef.current.delete(sessionId);
    if (kodyAbortRef.current === abort) kodyAbortRef.current = null;
  }
}

export interface SendMessageDeps {
  chatMode: ChatTerminalMode;
  input: string;
  attachments: Attachment[];
  contextChips: Array<{ id: string; label: string; context: string }>;
  isKodyWaiting: boolean;
  selectedTask: KodyTask | null;
  setInput: (value: string) => void;
  setContextChips: (chips: SendMessageDeps["contextChips"]) => void;
  setAttachments: (attachments: Attachment[]) => void;
  setSlashMenuOpen: (open: boolean) => void;
  setSlashSelectedIndex: (index: number) => void;
  setAgentMentionTrigger: (trigger: StaffMentionTrigger | null) => void;
  setMessages: (updater: MessagesUpdater) => void;
  pluginRegistry: PluginRegistry;
  pluginHost: MiddlewareContext["host"];
  handlePluginHostEffect: MiddlewareContext["dispatchHostEffect"];
  pendingTerminalIntentRef: MutableRefObject<TerminalIntentEffectPayload | null>;
  pendingSlashExpansionRef: MutableRefObject<SlashExpansionEffectPayload | null>;
  consumePendingTerminalIntent: () => TerminalIntentEffectPayload | null;
  consumePendingSlashExpansion: () => SlashExpansionEffectPayload | null;
  sendInputToTerminal: () => void;
  sendKodyTerminalPayloadToTerminal: (payload: string) => boolean;
  previewActChainRef: MutableRefObject<number>;
  sendText: SendTextFn;
}

export async function runSendMessage(deps: SendMessageDeps): Promise<void> {
  const {
    input,
    attachments,
    contextChips,
    setInput,
    setContextChips,
    setAttachments,
    setSlashMenuOpen,
    setSlashSelectedIndex,
    setAgentMentionTrigger,
    previewActChainRef,
    sendText,
  } = deps;
  if (!input.trim() && attachments.length === 0 && contextChips.length === 0) return;

  previewActChainRef.current = 0;
  const typedInput = input.trim();
  const message = [typedInput, ...contextChips.map((chip) => chip.context)]
    .filter((part) => part.trim())
    .join("\n\n");
  const displayContent = typedInput || contextChips.map((chip) => chip.label).join("\n");
  const currentAttachments = [...attachments];
  setInput("");
  setContextChips([]);
  setAttachments([]);
  setSlashMenuOpen(false);
  setSlashSelectedIndex(0);
  setAgentMentionTrigger(null);
  await sendText(message, currentAttachments, { displayContent });
}
