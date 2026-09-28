/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Message transcript region of the chat surface — the scrollable
 * messages container (sticky auto-scroll + "jump to latest" pill), per-message
 * bubbles (user/assistant, per-message text direction, markdown rendering,
 * reasoning/thinking panels, rendered-view cards, message actions,
 * attachments), the typing-indicator grace window and the streaming tool-call
 * list. Extracted verbatim from KodyChat (Step 3); sending, rendered-view
 * action handling, the empty state and terminal surfaces stay with the host,
 * wired through props.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { MessageActions } from "../../components/MessageActions";
import { MessageAttachments } from "../../components/MessageAttachments";
import { TypingIndicator } from "../../components/TypingIndicator";
import {
  ReasoningPanel,
  ThinkingPanel,
  ToolCallList,
} from "../../components/ToolCallCard";
import type { Message, ToolCall } from "../../components/kody-chat-types";
import { parseAssistantContent } from "../core/tool-call-strip";
import {
  getIncompleteAssistantNotice,
  isLikelyTransientAssistantStatus,
} from "../core/silent-turn";
import { softFormatUserMessageForDisplay } from "../core/user-message-format";
import {
  isRenderedViewDirective,
  type RenderedViewAction,
  type RenderedViewDirective,
} from "../../chat-ui-actions";
import { RenderedViewCard } from "./RenderedViewCard";
import type { WidgetHostEvent } from "./widget-host";
import {
  resolveTextDirection,
  rtlAwareMarkdownClassName,
  textIsolationStyle,
} from "../../text-direction";
import type { CompactionStatus } from "../../components/kody-chat-compaction";
import type { AgentHandoff } from "../../chat-types";

export function getMessageDirection(text: string) {
  return resolveTextDirection(text);
}

export const messageTextDirectionStyle = textIsolationStyle;

export function getAssessmentWriterRetryTurnId(
  message: Message,
): string | null {
  if (
    message.role !== "assistant" ||
    !parseAssistantContent(message.content).answer.startsWith(
      "Final report writing failed:",
    )
  ) {
    return null;
  }
  if (message.turnId) return message.turnId;
  return message.id?.startsWith("assistant:")
    ? message.id.slice("assistant:".length)
    : null;
}

const USER_MESSAGE_THEME_STYLE = {
  backgroundColor: "hsl(var(--chat-user, var(--primary)))",
  color: "hsl(var(--chat-user-foreground, var(--primary-foreground)))",
  "--primary-foreground": "var(--chat-user-foreground, 0 0% 100%)",
} as CSSProperties;

const ASSISTANT_MESSAGE_THEME_STYLE = {
  backgroundColor: "hsl(var(--chat-assistant, var(--muted)))",
  color: "hsl(var(--chat-assistant-foreground, var(--foreground)))",
} as CSSProperties;

export function shouldShowSilentAssistantNotice(input: {
  isLoading: boolean;
  hasAnswer: boolean;
  hasView: boolean;
  hasTransientStatus?: boolean;
}): boolean {
  return (
    !input.isLoading &&
    !input.hasView &&
    (!input.hasAnswer || input.hasTransientStatus === true)
  );
}

interface MessageListProps {
  /** Current surface mode — terminal mode swaps the container chrome. */
  chatMode: "ai" | "terminal";
  /** Transcript of the active session (already mapped to UI messages). */
  messages: Message[];
  /** Host transcript setter — retry/edit/delete rewrite the message list. */
  setMessages: Dispatch<SetStateAction<Message[]>>;
  /** Resubmit a user turn after retry/edit trimmed the transcript. */
  onResend: (content: string) => void;
  /** Retries only final report writing from a failed turn's saved checkpoint. */
  onRetryAssessmentWriting?: (turnId: string) => void;
  /** True while a turn is in flight (streaming or awaiting first byte). */
  activeLoading: boolean;
  /** Temporary, non-transcript status for automatic model-memory compaction. */
  compactionStatus: CompactionStatus;
  /** Active session id — scopes the thinking/reasoning persist keys. */
  activeSessionId: string | undefined;
  /** Streaming tool calls not yet folded into a message. */
  toolCalls: ToolCall[];
  /** Rendered-view ids already consumed (locks the card after click). */
  usedViewIds: Set<string>;
  /** Host handler for rendered-view card actions. */
  onRenderedViewAction: (
    view: RenderedViewDirective,
    action: RenderedViewAction,
  ) => void;
  /** Forwards a validated widget event to the chat surface that owns it. */
  onWidgetEvent: (view: RenderedViewDirective, event: WidgetHostEvent) => void;
  /** Mode-specific empty-transcript content, shown when no messages exist. */
  emptyState: ReactNode;
  /** Mounted terminal surfaces, rendered inside the scroll container. */
  terminalSurfaces: ReactNode;
  /** Role alignment policy. Defaults to dashboard chat behavior. */
  roleLayout?: "dashboard" | "client";
  /** Non-message conversation events rendered in transcript order. */
  agentHandoffs?: AgentHandoff[];
  /** Navigates Kody-owned links without leaving the active dashboard page. */
  onInternalLinkClick?: (href: string) => void;
}

export function messageJustifyClass(
  role: Message["role"],
  layout: NonNullable<MessageListProps["roleLayout"]>,
): string {
  const alignRight =
    layout === "client" ? role === "assistant" : role === "user";
  return alignRight ? "justify-end" : "justify-start";
}

export function isRenderedViewMessageActive(
  messages: readonly Message[],
  messageIndex: number,
  usedViewIds: ReadonlySet<string>,
): boolean {
  const message = messages[messageIndex];
  if (
    !message?.view ||
    !isRenderedViewDirective(message.view) ||
    message.view.result !== undefined ||
    usedViewIds.has(message.view.id)
  ) {
    return false;
  }

  return messages
    .slice(messageIndex + 1)
    .filter((later) => !later.hidden)
    .every((later) => later.role === "assistant" && !later.view);
}

export function MessageList({
  chatMode,
  messages,
  setMessages,
  onResend,
  onRetryAssessmentWriting,
  activeLoading,
  compactionStatus,
  activeSessionId,
  toolCalls,
  usedViewIds,
  onRenderedViewAction,
  onWidgetEvent,
  emptyState,
  terminalSurfaces,
  roleLayout = "dashboard",
  agentHandoffs = [],
  onInternalLinkClick,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const timeline = [
    ...messages.map((message, messageIndex) => ({
      kind: "message" as const,
      message,
      messageIndex,
      timestamp: message.timestamp ?? "",
    })),
    ...agentHandoffs.map((handoff, handoffIndex) => ({
      kind: "handoff" as const,
      handoff,
      handoffIndex,
      timestamp: handoff.switchedAt,
    })),
  ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setIsAtBottom(true);
  }, []);

  // Track whether the user is pinned to the bottom. We only auto-scroll on new
  // content when they are — otherwise scrolling up to read history would fight
  // every streamed token. Threshold is generous (80px) to account for the
  // input bar and "new messages" pill overlap.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 80);
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, activeLoading, compactionStatus, isAtBottom, scrollToBottom]);

  // 800ms grace period for the typing indicator (issue #330). The agentIdentity
  // tells the model to emit a short status line (≤8 words) as the very first
  // word of every reply so the bubble is never blank. The grace timer is the
  // UI backstop for that prompt — if the model is still silent after 800ms
  // (engine first-byte lag, slow cold start, no status line), we surface the
  // existing TypingIndicator. The moment the first visible token lands, the
  // per-bubble `!hasAnswer` check hides it again. Resets on every new turn
  // (any change in `activeLoading`).
  const [showTypingAfterGrace, setShowTypingAfterGrace] = useState(false);
  useEffect(() => {
    if (!activeLoading) {
      setShowTypingAfterGrace(false);
      return;
    }
    setShowTypingAfterGrace(false);
    const t = setTimeout(() => setShowTypingAfterGrace(true), 800);
    return () => clearTimeout(t);
  }, [activeLoading]);

  return (
    <>
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className={`flex-1 min-h-0 relative ${
          chatMode === "terminal"
            ? "overflow-hidden bg-[#050608]"
            : "overflow-auto px-1.5 py-2 sm:p-4 space-y-4"
        }`}
      >
        {chatMode === "ai" &&
          messages.length === 0 &&
          !activeLoading &&
          emptyState}

        {terminalSurfaces}

        {chatMode === "ai" &&
          timeline.map((item) => {
            if (item.kind === "handoff") {
              return (
                <div
                  key={`handoff-${item.handoff.switchedAt}-${item.handoffIndex}`}
                  data-testid="agent-handoff"
                  className="flex items-center gap-3 py-1 text-xs text-muted-foreground"
                >
                  <span className="h-px flex-1 bg-border" />
                  <span>
                    {item.handoff.fromTitle} → {item.handoff.toTitle}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              );
            }
            const msg = item.message;
            const i = item.messageIndex;
            if (msg.hidden) return null;

            const parsedAssistant =
              msg.role === "assistant"
                ? parseAssistantContent(msg.content)
                : null;
            const visibleText = parsedAssistant?.answer || msg.content;
            const messageDirection = getMessageDirection(visibleText);
            // Bubbles carrying a rendered view span the full row so the
            // view isn't cramped by the text-sized bubble width cap.
            const hasRenderedView =
              msg.role === "assistant" &&
              !!msg.view &&
              isRenderedViewDirective(msg.view);
            const assessmentRetryTurnId = getAssessmentWriterRetryTurnId(msg);

            return (
              <div
                key={i}
                data-role={msg.role}
                className={`group flex ${messageJustifyClass(msg.role, roleLayout)} relative`}
              >
                <div
                  dir={messageDirection}
                  data-testid={`chat-${msg.role}-message`}
                  style={{
                    ...messageTextDirectionStyle,
                    ...(msg.role === "user"
                      ? USER_MESSAGE_THEME_STYLE
                      : ASSISTANT_MESSAGE_THEME_STYLE),
                    fontSize: "var(--chat-message-font-size, 17px)",
                  }}
                  className={`${
                    hasRenderedView
                      ? "w-full max-w-full"
                      : "max-w-[92%] sm:max-w-[85%]"
                  } min-w-0 break-words rounded-lg px-3 py-2 leading-relaxed`}
                >
                  {msg.role === "assistant" &&
                    msg.notices?.map((notice) => (
                      <div
                        key={notice}
                        className="mb-2 rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-200"
                        role="status"
                      >
                        {notice}
                      </div>
                    ))}
                  {/* Message Actions */}
                  <MessageActions
                    role={msg.role}
                    content={msg.content}
                    isLast={i === messages.length - 1}
                    isLoading={!!msg.isLoading}
                    hasToolCalls={!!msg.toolCalls && msg.toolCalls.length > 0}
                    onCopy={() => msg.content}
                    onRetry={
                      msg.role === "assistant" && i === messages.length - 1
                        ? () => {
                            if (
                              assessmentRetryTurnId &&
                              onRetryAssessmentWriting
                            ) {
                              onRetryAssessmentWriting(assessmentRetryTurnId);
                              return;
                            }
                            // Walk back to the last user message. Drop both that
                            // user turn AND the failed assistant reply — sendText
                            // pushes a fresh user bubble, so trimming both keeps
                            // the transcript intact (no duplicate user msg).
                            let userIdx = -1;
                            for (let j = i - 1; j >= 0; j--) {
                              if (messages[j].role === "user") {
                                userIdx = j;
                                break;
                              }
                            }
                            if (userIdx < 0) return;
                            const lastUserContent = messages[userIdx].content;
                            setMessages((prev) => prev.slice(0, userIdx));
                            onResend(lastUserContent);
                          }
                        : undefined
                    }
                    retryLabel={
                      assessmentRetryTurnId
                        ? "Retry report writing only"
                        : undefined
                    }
                    onEdit={
                      msg.role === "user"
                        ? (content) => {
                            // Drop the edited user msg + everything after it,
                            // then resubmit. sendText repushes the user bubble
                            // with the new content, so we don't keep the old one.
                            setMessages((prev) => prev.slice(0, i));
                            onResend(content);
                          }
                        : undefined
                    }
                    onDelete={() => {
                      setMessages((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  />

                  {msg.role === "assistant" ? (
                    <>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ThinkingPanel
                          toolCalls={msg.toolCalls}
                          isStreaming={!!msg.isLoading}
                          persistKey={
                            activeSessionId && !msg.isLoading
                              ? `${activeSessionId}:${msg.timestamp ?? i}`
                              : undefined
                          }
                        />
                      )}
                      {(() => {
                        // Strip model-emitted tool-call markup (`<kody_run_issue />`
                        // and `<tool_call>…</tool_call>` blocks) from the visible
                        // answer — the structured call is already surfaced via
                        // the ThinkingPanel above, and the raw XML in the
                        // text stream is just noise. Bare URLs get auto-linked
                        // by `remark-gfm` below.
                        const { reasoning, answer } = parsedAssistant ?? {
                          reasoning: "",
                          answer: "",
                        };
                        const isActive =
                          activeLoading && i === messages.length - 1;
                        const hasAnswer = answer.trim().length > 0;
                        const hasTransientStatus =
                          isLikelyTransientAssistantStatus(answer);
                        return (
                          <>
                            {reasoning && (
                              <ReasoningPanel
                                content={reasoning}
                                isStreaming={!!msg.isLoading}
                                persistKey={
                                  activeSessionId && !msg.isLoading
                                    ? `${activeSessionId}:${msg.timestamp ?? i}`
                                    : undefined
                                }
                              />
                            )}
                            {hasAnswer && (
                              <MarkdownPreview
                                content={answer}
                                dir={messageDirection}
                                style={messageTextDirectionStyle}
                                onInternalLinkClick={onInternalLinkClick}
                                className={`chat-message-text text-start prose-base break-words ${rtlAwareMarkdownClassName} [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words`}
                              />
                            )}
                            {shouldShowSilentAssistantNotice({
                              isLoading: !!msg.isLoading,
                              hasAnswer,
                              hasView: Boolean(msg.view),
                              hasTransientStatus,
                            }) && (
                              <div
                                role="alert"
                                className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
                              >
                                {getIncompleteAssistantNotice({
                                  hasToolActivity:
                                    (msg.toolCalls?.length ?? 0) > 0,
                                  hasTransientStatus,
                                })}
                              </div>
                            )}
                            {parsedAssistant?.strippedToolMarkup &&
                              !msg.isLoading && (
                                <div
                                  role="alert"
                                  className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
                                >
                                  The model wrote a tool call as plain text — it
                                  did NOT execute. Any result or id it reported
                                  for that call is unverified.
                                </div>
                              )}
                            {msg.view && isRenderedViewDirective(msg.view) && (
                              <RenderedViewCard
                                view={msg.view}
                                disabled={
                                  !!msg.isLoading ||
                                  !isRenderedViewMessageActive(
                                    messages,
                                    i,
                                    usedViewIds,
                                  )
                                }
                                onAction={(action) =>
                                  onRenderedViewAction(
                                    msg.view as RenderedViewDirective,
                                    action,
                                  )
                                }
                                onWidgetEvent={(event) =>
                                  onWidgetEvent(
                                    msg.view as RenderedViewDirective,
                                    event,
                                  )
                                }
                              />
                            )}
                            {/* Never a blank bubble: while the turn is in flight and
                          no visible answer text has arrived yet, show the
                          thinking indicator — but only after the 800ms grace
                          timer (issue #330). The agentIdentity's status-line rule
                          should already have given the model a chance to
                          emit a first-line within that window; the indicator
                          is the backstop for when it didn't. Covers the
                          reasoning-only / tool-call phase where content is
                          just <think> blocks. */}
                            {isActive && showTypingAfterGrace && !hasAnswer && (
                              <TypingIndicator />
                            )}
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <MessageAttachments attachments={msg.attachments} />
                      )}
                      {msg.content && (
                        <MarkdownPreview
                          content={softFormatUserMessageForDisplay(msg.content)}
                          dir={messageDirection}
                          style={messageTextDirectionStyle}
                          onInternalLinkClick={onInternalLinkClick}
                          className={`chat-message-text text-start prose-base break-words prose-invert ${rtlAwareMarkdownClassName} prose-headings:my-1 prose-headings:text-primary-foreground prose-p:my-0 prose-p:whitespace-pre-wrap prose-p:leading-relaxed prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-a:text-primary-foreground prose-a:underline prose-code:bg-primary-foreground/20 prose-code:text-primary-foreground prose-pre:bg-primary-foreground/15 prose-ul:my-1 prose-ul:text-primary-foreground prose-ol:my-1 prose-ol:text-primary-foreground prose-li:my-0 prose-li:marker:text-primary-foreground/70 prose-blockquote:my-1 prose-blockquote:text-primary-foreground prose-table:text-primary-foreground prose-th:text-primary-foreground [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words`}
                        />
                      )}
                    </>
                  )}
                  {activeLoading &&
                    i === messages.length - 1 &&
                    msg.role === "assistant" &&
                    parsedAssistant?.answer.trim() && (
                      <span className="inline-block ms-2 animate-pulse text-primary">
                        ●
                      </span>
                    )}
                </div>
              </div>
            );
          })}

        {/* Typing indicator shown before an assistant placeholder exists.
          Covers the Kody-engine first-byte window where the placeholder is
          only pushed once the first SSE event arrives. Gated on the same
          800ms grace timer as the in-bubble indicator (#330) so a fast
          model that emits the agentIdentity's status line quickly never flashes
          the typing bubble. */}
        {chatMode === "ai" &&
          activeLoading &&
          showTypingAfterGrace &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="max-w-[92%] sm:max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                <TypingIndicator />
              </div>
            </div>
          )}

        {/* Tool calls display - using ToolCallList component */}
        {chatMode === "ai" && toolCalls.length > 0 && (
          <div className="flex justify-start">
            <ToolCallList
              toolCalls={toolCalls.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result,
                status: tc.status,
                startedAt: tc.startedAt,
                durationMs: tc.durationMs,
                description: tc.description,
              }))}
            />
          </div>
        )}

        {chatMode === "ai" && compactionStatus && (
          <div
            role="status"
            aria-live="polite"
            data-testid="conversation-compaction-status"
            className="flex justify-center"
          >
            <div className="flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
              {compactionStatus === "compacting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              {compactionStatus === "compacting"
                ? "Compacting conversation…"
                : "Conversation compacted"}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* "Jump to latest" pill — visible only when the user has scrolled up
        and is therefore not pinned to the bottom. Clicking re-engages
        sticky scrolling. */}
      {!isAtBottom && (
        <div className="relative">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="absolute -top-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-2 text-body-xs font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
            aria-label="Jump to latest messages"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {activeLoading ? "New messages" : "Jump to latest"}
          </button>
        </div>
      )}
    </>
  );
}
