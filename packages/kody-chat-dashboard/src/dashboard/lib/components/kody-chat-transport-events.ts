/**
 * @fileType module
 * @domain kody
 * @pattern chat-transport-event-mapping
 * @ai-summary The ONE event-mapping layer between the ChatTransport
 *   adapters (chat/core/transports/*) and KodyChat's UI state. Adapters
 *   decide WHAT to emit (protocol mechanics, directive shape detection);
 *   this handler decides HOW the UI reacts — the exact setMessages /
 *   setLoading updates sendText performed inline before Step 2c.
 *   Directives are collected into per-turn pending state; KodyChat applies
 *   them after the stream settles (agent flip, navigation, preview-act
 *   chaining), except rendered-view which attaches to the in-flight bubble
 *   immediately (as before). No React imports — the state setters are
 *   injected, so the mapping stays unit-testable in node.
 */

import type { ChatEvent } from "../chat/core/transports/transport-types";
import { BRAIN_ERROR_CODE_EXHAUSTED } from "../chat/core/transports/brain";
import type {
  DashboardNavigateDirective,
  PreviewActDirective,
  RenderedViewDirective,
  SwitchAgentDirective,
} from "../chat-ui-actions";
import { SHOW_VIEW_TOOL } from "../chat-output-tools";
import { stripReasoning } from "../chat/core/reasoning";
import {
  getCreatedIssueNumberFromToolOutput,
  type Message,
} from "./kody-chat-types";
import { updateActiveAssistant } from "./kody-chat-turn-surface";

/**
 * Per-turn accumulation the surface reads back after the transport
 * settles: the composed text buffers (assistant text + voice), the last
 * tool error (empty-bubble fallback), and the deferred UI directives.
 */
export interface TransportTurnState {
  /** Model thought summaries — wrapped in <think>…</think> for display. */
  reasoningBuf: string;
  /** The visible answer text (kody-direct delta stream). */
  textBuf: string;
  /** Latest full assistant snapshot (brain message replay). */
  latestAssistantText: string;
  /** Brain reconnect budget ran out — surface returns null (no TTS). */
  exhausted: boolean;
  lastToolErrorText: string | null;
  lastToolErrorToolName: string | null;
  pendingSwitchAgent: SwitchAgentDirective | null;
  pendingDashboardNavigate: DashboardNavigateDirective | null;
  pendingPreviewAct: PreviewActDirective | null;
  pendingView: RenderedViewDirective | null;
  pendingCreatedIssue: number | null;
}

export interface TransportTurnHooks {
  /** Session-scoped functional setMessages (KodyChat wraps the store). */
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setLoading: (loading: boolean) => void;
  /**
   * Voice-mode delta sink (already wraps onVoiceDelta with a reasoning
   * strip). Null outside voice mode.
   */
  emitVoiceDelta: ((full: string) => void) | null;
  voiceMode: boolean;
}

export interface TransportTurnHandler {
  state: TransportTurnState;
  handleEvent: (event: ChatEvent) => void;
}

function createInitialState(): TransportTurnState {
  return {
    reasoningBuf: "",
    textBuf: "",
    latestAssistantText: "",
    exhausted: false,
    lastToolErrorText: null,
    lastToolErrorToolName: null,
    pendingSwitchAgent: null,
    pendingDashboardNavigate: null,
    pendingPreviewAct: null,
    pendingView: null,
    pendingCreatedIssue: null,
  };
}

/**
 * Build the per-turn ChatEvent handler. One instance per sendText turn —
 * the returned `state` is the turn's scratch space and is read by the
 * post-stream code (settle block, directive application, spoken text).
 */
export function createTransportTurnHandler(
  hooks: TransportTurnHooks,
): TransportTurnHandler {
  const state = createInitialState();
  const { setMessages } = hooks;

  const composeContent = () =>
    (state.reasoningBuf ? `<think>${state.reasoningBuf}</think>\n\n` : "") +
    state.textBuf;

  /** Rewrite the in-flight assistant bubble from the text buffers. */
  const syncComposedContent = () => {
    const content = composeContent();
    setMessages((prev) =>
      updateActiveAssistant(prev, (message) => ({
        ...message,
        content,
        isLoading: true,
      })),
    );
  };

  const handleEvent = (event: ChatEvent): void => {
    switch (event.type) {
      case "notice": {
        setMessages((prev) =>
          updateActiveAssistant(prev, (message) => ({
            ...message,
            notices: [...(message.notices ?? []), event.message],
          })),
        );
        return;
      }
      case "token": {
        state.textBuf += event.text;
        hooks.emitVoiceDelta?.(stripReasoning(state.textBuf));
        syncComposedContent();
        return;
      }
      case "reasoning": {
        // Voice mode never shows or speaks reasoning — drop at the sink
        // so the bubble equals textBuf and TTS gets exactly what the
        // user reads.
        if (!hooks.voiceMode) {
          state.reasoningBuf += event.text;
          syncComposedContent();
        }
        return;
      }
      case "text-replace": {
        // final_answer supersedes whatever streamed before it.
        state.textBuf = event.text;
        hooks.emitVoiceDelta?.(stripReasoning(state.textBuf));
        syncComposedContent();
        return;
      }
      case "message": {
        // Brain replays FULL snapshots: replace the in-flight bubble
        // (preserving any toolCalls already attached so the thinking
        // panel doesn't flicker), or push one if text hasn't started.
        if (event.role !== "user" && typeof event.content === "string") {
          state.latestAssistantText = event.content;
          hooks.emitVoiceDelta?.(state.latestAssistantText);
        }
        const role: Message["role"] =
          event.role === "user" ? "user" : "assistant";
        setMessages((prev) => {
          const updated = updateActiveAssistant(prev, (message) => ({
            ...message,
            role,
            content: event.content ?? "",
            timestamp: event.timestamp ?? message.timestamp,
            isLoading: true,
          }));
          return updated === prev
            ? [
                ...prev,
                {
                  role,
                  content: event.content ?? "",
                  timestamp: event.timestamp ?? new Date().toISOString(),
                  isLoading: true,
                },
              ]
            : updated;
        });
        return;
      }
      case "tool-call": {
        // Attach a chip to the in-flight assistant bubble so the user
        // sees live progress (kody-direct: "running"; brain reports
        // completed calls: "success"). Create a placeholder loading
        // bubble if text deltas haven't started yet.
        const args = (
          event.input && typeof event.input === "object" ? event.input : {}
        ) as Record<string, unknown>;
        setMessages((prev) => {
          const toolCall = {
            ...(event.id ? { id: event.id } : {}),
            name: event.toolName,
            arguments: args,
            status: event.status ?? "running",
            ...(event.description ? { description: event.description } : {}),
            ...(event.activityKind ? { activityKind: event.activityKind } : {}),
            ...(event.displayName ? { displayName: event.displayName } : {}),
          };
          const updated = updateActiveAssistant(prev, (message) => ({
            ...message,
            toolCalls: [...(message.toolCalls ?? []), toolCall],
          }));
          return updated === prev
            ? [
                ...prev,
                {
                  role: "assistant",
                  content: "",
                  timestamp: event.timestamp ?? new Date().toISOString(),
                  isLoading: true,
                  toolCalls: [toolCall],
                },
              ]
            : updated;
        });
        return;
      }
      case "tool-result": {
        if (event.isError) {
          state.lastToolErrorText = event.errorText ?? "Tool call failed";
          // `output` present = a tool RAN and returned an error shape —
          // record which tool for the empty-bubble fallback. Absent =
          // stream-level tool failure (tool-output-error), which never
          // updated the tool name before either.
          const ranWithOutput = event.output !== undefined;
          if (ranWithOutput) {
            state.lastToolErrorToolName = event.toolName ?? null;
            if (event.toolName === SHOW_VIEW_TOOL) {
              state.textBuf = "";
            }
          }
          setMessages((prev) => {
            return updateActiveAssistant(prev, (message) => ({
              ...message,
              ...(ranWithOutput && event.toolName === SHOW_VIEW_TOOL
                ? { content: "" }
                : {}),
              toolCalls: (message.toolCalls ?? []).map((toolCall) =>
                toolCall.id === event.id
                  ? {
                      ...toolCall,
                      status: "error" as const,
                      ...(event.errorText ? { result: event.errorText } : {}),
                    }
                  : toolCall,
              ),
            }));
          });
          return;
        }
        // Issue creation: a whitelisted create_* / report_bug tool that
        // returned `{ number }` opened a GitHub issue — capture it so the
        // post-stream handler can navigate. Name-based only (read tools
        // return the same shape for EXISTING issues).
        const createdIssueNumber = getCreatedIssueNumberFromToolOutput(
          event.toolName,
          event.output,
        );
        if (createdIssueNumber !== null) {
          state.pendingCreatedIssue = createdIssueNumber;
        }
        // Flip the matching running chip to "success".
        setMessages((prev) => {
          return updateActiveAssistant(prev, (message) => ({
            ...message,
            toolCalls: (message.toolCalls ?? []).map((toolCall) =>
              toolCall.id === event.id
                ? { ...toolCall, status: "success" as const }
                : toolCall,
            ),
          }));
        });
        return;
      }
      case "directive": {
        const { directive } = event;
        switch (directive.kind) {
          case "switch-agent":
            // Defer — applied after the bubble settles so the agent flip
            // doesn't race the in-flight render.
            state.pendingSwitchAgent = directive.payload;
            return;
          case "dashboard-navigate":
            state.pendingDashboardNavigate = directive.payload;
            return;
          case "preview-act":
            state.pendingPreviewAct = directive.payload;
            return;
          case "rendered-view": {
            // A guided-flow step card carries the submit wiring
            // (instanceId/stepId/revision). If the model re-renders the
            // same step via show_view later in the turn, that echo is a
            // chat-target view without the wiring — letting it overwrite
            // the guided-flow card would turn its buttons into plain chat
            // replies and the flow would never advance.
            if (
              state.pendingView?.resultTarget === "guided-flow" &&
              directive.payload.resultTarget !== "guided-flow"
            ) {
              return;
            }
            // The view attaches immediately as another ordered message part.
            // Renderer-only replies replace draft text; a view after committed
            // text appends without erasing what the user already read.
            state.pendingView = directive.payload;
            if (directive.presentation === "replace") {
              state.textBuf = "";
            }
            setMessages((prev) => {
              const updated = updateActiveAssistant(prev, (message) => ({
                ...message,
                view: directive.payload,
              }));
              return updated === prev
                ? [
                    ...prev,
                    {
                      role: "assistant",
                      content: "",
                      timestamp: new Date().toISOString(),
                      isLoading: true,
                      toolCalls: [],
                      view: directive.payload,
                    },
                  ]
                : updated;
            });
            syncComposedContent();
            return;
          }
        }
        return;
      }
      case "error": {
        if (event.recoverable) {
          // Inline stream error — appended to the visible text, exactly
          // like the old `textBuf += "\n\n[Error] …"` (no voice delta).
          state.textBuf += `\n\n[Error] ${event.message}`;
          syncComposedContent();
          return;
        }
        // Terminal turn failure (brain chat.error / reconnects
        // exhausted): drop the in-flight bubble, surface an error bubble.
        if (event.code === BRAIN_ERROR_CODE_EXHAUSTED) {
          state.exhausted = true;
        }
        hooks.setLoading(false);
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) => !(m.role === "assistant" && m.isLoading),
          );
          return [
            ...filtered,
            {
              role: "assistant",
              content: `Error: ${event.message}`,
              isLoading: false,
              isError: true,
            },
          ];
        });
        return;
      }
      case "done": {
        // Terminal stream event: always clear the typing indicator. Only a
        // SETTLED done (brain) may also unmark loading bubbles — kody-direct
        // emits an unsettled done because finalizeKodyDirectTurn locates the
        // in-flight bubble by its isLoading flag (the tool-error and
        // empty-turn fallbacks depend on it surviving until send() resolves).
        hooks.setLoading(false);
        if (event.settled) {
          setMessages((prev) =>
            prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
          );
        }
        return;
      }
      case "status":
        // Lifecycle telemetry — no UI mapping today.
        return;
    }
  };

  return { state, handleEvent };
}
