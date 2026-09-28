/**
 * @fileType module
 * @domain chat-platform
 * @pattern chat-transport-adapter
 * @ai-summary Kody-direct ChatTransport adapter (plan H1, Step 2c).
 *   Lifecycle model: client-driven tool loop — one stateless POST to
 *   /api/kody/chat/kody streaming Vercel AI SDK UI chunks as SSE. The
 *   adapter owns the SSE parse, the toolCallId→name / name→description
 *   bookkeeping, the final_answer text replacement, and directive shape
 *   detection (switch_agent / dashboard_navigate / preview_act /
 *   render_view) — emitting them as ChatEvents. The surface owns bubbles,
 *   the abort controller, and the post-stream directive application
 *   (including preview_act chaining into a synthetic follow-up turn). A clean
 *   EOF (after `finish`/`[DONE]`) emits `done`; an EOF without a terminal
 *   marker throws a typed disconnect so the surface can recover the durable
 *   server turn. The shared coordinator owns terminal lifecycle state.
 */

import { parseKodyDirectChunk, type KodyDirectChunk } from "./envelope";
import type { ChatTransport, ChatTransportContext } from "./transport-types";
import {
  isDashboardNavigateDirective,
  isPreviewActDirective,
  isRenderedViewDirective,
  isSwitchAgentDirective,
} from "../../../chat-ui-actions";
import {
  CHAT_OUTPUT_CONTRACT_DATA_TYPE,
  FINAL_ANSWER_TOOL,
  getToolErrorMessage,
  isExclusiveToolOutputContract,
  isFinalAnswerOutput,
} from "../../../chat-output-tools";
import { compilePreparedTurnPayload } from "../conversation/prepared-turn-payload";
import { normalizeModelOperationFailure } from "../silent-turn";

/** Stable code for a stream that dropped while its durable turn continued. */
export const KODY_DIRECT_ERROR_CODE_DROPPED = "kody-direct-dropped";

export const KODY_DIRECT_DROPPED_MESSAGE =
  "The connection closed before the reply finished. Kody is still working and the result will appear automatically.";

/** The browser stream ended, but the durable server turn may still complete. */
export class KodyDirectConnectionDroppedError extends Error {
  readonly code = KODY_DIRECT_ERROR_CODE_DROPPED;

  constructor() {
    super(KODY_DIRECT_DROPPED_MESSAGE);
    this.name = "KodyDirectConnectionDroppedError";
  }
}

export interface KodyDirectTurnConfig {
  /** `/api/kody/chat/kody`. */
  endpoint: string;
  /**
   * The full request body (messages, task, agentId, voiceMode, vibeMode,
   * model, reasoningEffort, org/capability/report context, …).
   * Assembled by the surface — it owns that state.
   */
  body: Readonly<Record<string, unknown>>;
}

/**
 * Decode the available prefix of one JSON string property while its object is
 * still streaming. Incomplete escape sequences are held until the next chunk.
 */
function readStreamingJsonStringProperty(
  jsonPrefix: string,
  property: string,
): string | null {
  const propertyMatch = new RegExp(
    `"${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`,
  ).exec(jsonPrefix);
  if (!propertyMatch) return null;

  let value = "";
  for (
    let index = propertyMatch.index + propertyMatch[0].length;
    index < jsonPrefix.length;
    index += 1
  ) {
    const char = jsonPrefix[index];
    if (char === '"') return value;
    if (char !== "\\") {
      value += char;
      continue;
    }

    const escaped = jsonPrefix[index + 1];
    if (escaped === undefined) return value;
    if (escaped === "u") {
      const code = jsonPrefix.slice(index + 2, index + 6);
      if (code.length < 4 || !/^[0-9a-f]{4}$/i.test(code)) return value;
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 5;
      continue;
    }
    const decodedEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    const decoded = decodedEscapes[escaped];
    if (decoded === undefined) return value;
    value += decoded;
    index += 1;
  }
  return value;
}

function isKodyDirectTurnConfig(value: unknown): value is KodyDirectTurnConfig {
  if (!value || typeof value !== "object") return false;
  const cfg = value as Partial<KodyDirectTurnConfig>;
  return (
    typeof cfg.endpoint === "string" &&
    !!cfg.body &&
    typeof cfg.body === "object"
  );
}

async function readHttpError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `HTTP ${res.status}`;

  try {
    const body = JSON.parse(text) as {
      error?: unknown;
      message?: unknown;
      traceId?: unknown;
    };
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : null;
    if (message) {
      const responseMessage =
        typeof body.traceId === "string" && body.traceId
          ? `${message} (trace ${body.traceId})`
          : message;
      return normalizeModelOperationFailure(responseMessage);
    }
  } catch {
    // A proxy may return HTML or plain text; preserve that response below.
  }

  return normalizeModelOperationFailure(text);
}

/**
 * Run one kody-direct turn: POST the transcript, stream SSE chunks, emit
 * ChatEvents. HTTP failures and AbortErrors THROW (the surface owns its
 * historical catch semantics). Stream-level `error` chunks are emitted as
 * RECOVERABLE error events (they append to the visible text). A clean stream
 * emits `done` so the shared turn coordinator can settle the turn explicitly.
 */
export async function sendKodyDirectTurn(
  config: KodyDirectTurnConfig,
  ctx: ChatTransportContext,
): Promise<void> {
  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx.authHeaders },
    signal: ctx.signal,
    body: JSON.stringify(config.body),
  });

  if (!res.ok || !res.body) {
    throw new Error(await readHttpError(res));
  }

  // The kody route streams Vercel AI SDK UI messages as SSE
  // (`data: {json}\n\n`). Parse incrementally; the surface splits the
  // emitted deltas into its reasoning/text buffers.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  // Map of toolCallId → toolName, populated from `tool-input-available`
  // chunks so we can identify the source tool when its
  // `tool-output-available` arrives (the output chunk omits the name).
  const toolNameById = new Map<string, string>();
  const toolInputTextById = new Map<string, string>();
  const streamedFinalAnswerById = new Map<string, string>();
  const reasoningSubagentIds = new Set<string>();
  // Map of toolName → human-readable description, hydrated from the
  // `data-tools-index` event the route emits at the start of the stream
  // (issue #321). One event per turn — not one per call — so this map is
  // small and stable for the lifetime of the turn.
  const toolDescriptionByName = new Map<string, string>();
  // When the route can require an output tool, raw provider text is only a
  // draft. The semantic output arrives later through final_answer/show_view.
  // Keep legacy/raw streams unchanged when the route does not declare this
  // contract, including mocked and older-server responses.
  let exclusiveToolOutput = false;
  let hasVisibleTextOutput = false;
  let committedFinalAnswer = false;
  // A healthy AI SDK UI stream always ends with a `finish` chunk followed
  // by the `[DONE]` sentinel. An EOF without either means the connection
  // dropped mid-turn (network blip, proxy kill, laptop sleep) — the server
  // may keep working, but nothing will reach this client. Without this
  // flag a drop is indistinguishable from a clean finish and the chat
  // goes silent with no error.
  let sawTerminal = false;
  let receivedRenderedView = false;

  const applyChunk = (chunk: KodyDirectChunk): void => {
    if (
      chunk.type === "data-automatic-fallback" &&
      chunk.data &&
      typeof chunk.data.from === "string" &&
      typeof chunk.data.to === "string"
    ) {
      const reason =
        chunk.data.reason === "timeout"
          ? "timed out"
          : chunk.data.reason === "network"
            ? "had a network error"
            : chunk.data.reason === "server_error"
              ? "had a temporary server error"
              : "is rate limited";
      ctx.emit({
        type: "notice",
        message: `${chunk.data.from} ${reason}. Continuing with ${chunk.data.to}.`,
      });
    } else if (chunk.type === "finish") {
      sawTerminal = true;
      return;
    }
    if (
      chunk.type === "data-subagent-activity" &&
      chunk.data &&
      typeof chunk.data.id === "string" &&
      typeof chunk.data.agentTitle === "string"
    ) {
      const phase = chunk.data.phase;
      if (phase === "started") {
        ctx.emit({
          type: "tool-call",
          id: chunk.data.id,
          toolName: "subagent",
          input:
            typeof chunk.data.task === "string"
              ? { task: chunk.data.task }
              : {},
          status: "running",
          activityKind: "subagent",
          displayName: chunk.data.agentTitle,
          description: "Working on delegated specialist research.",
        });
      } else if (phase === "heartbeat") {
        // Reset the turn inactivity deadline without creating another visible
        // specialist item or adding user-visible reasoning text.
        ctx.emit({ type: "reasoning", text: "\u200b" });
      } else if (
        phase === "reasoning" &&
        typeof chunk.data.reasoningDelta === "string" &&
        chunk.data.reasoningDelta
      ) {
        if (!reasoningSubagentIds.has(chunk.data.id)) {
          reasoningSubagentIds.add(chunk.data.id);
          ctx.emit({
            type: "reasoning",
            text: `${chunk.data.agentTitle}:\n`,
          });
        }
        ctx.emit({ type: "reasoning", text: chunk.data.reasoningDelta });
      } else if (phase === "completed" || phase === "failed") {
        const errorText =
          typeof chunk.data.errorText === "string" &&
          chunk.data.errorText.trim()
            ? chunk.data.errorText
            : "Specialist work failed";
        ctx.emit({
          type: "tool-result",
          id: chunk.data.id,
          toolName: "subagent",
          output: { status: phase },
          ...(phase === "failed" ? { isError: true, errorText } : {}),
        });
        if (
          phase === "completed" &&
          typeof chunk.data.reasoning === "string" &&
          chunk.data.reasoning.trim()
        ) {
          ctx.emit({
            type: "reasoning",
            text: `${chunk.data.agentTitle}:\n${chunk.data.reasoning.trim()}\n\n`,
          });
        }
      }
    } else if (
      chunk.type === CHAT_OUTPUT_CONTRACT_DATA_TYPE &&
      isExclusiveToolOutputContract(chunk.data)
    ) {
      exclusiveToolOutput = true;
    } else if (
      chunk.type === "text-delta" &&
      typeof chunk.delta === "string" &&
      !exclusiveToolOutput &&
      !committedFinalAnswer
    ) {
      hasVisibleTextOutput = true;
      ctx.emit({ type: "token", text: chunk.delta });
    } else if (
      chunk.type === "reasoning-delta" &&
      typeof chunk.delta === "string" &&
      // Exclusive output means every model attempt is private until an
      // output tool commits the one user-visible result.
      !exclusiveToolOutput &&
      !committedFinalAnswer
    ) {
      ctx.emit({ type: "reasoning", text: chunk.delta });
    } else if (chunk.type === "error" && typeof chunk.errorText === "string") {
      // Inline stream error — the surface appends it to the transcript.
      // Counts as terminal: the user already sees why the turn ended, so
      // an EOF right after must not also report a dropped connection.
      sawTerminal = true;
      ctx.emit({
        type: "error",
        message: normalizeModelOperationFailure(chunk.errorText),
        recoverable: true,
      });
    } else if (
      chunk.type === "data-tools-index" &&
      chunk.data &&
      typeof chunk.data === "object"
    ) {
      // One name→description map for every tool in the merged tool set.
      // Each new tool chip looks its name up here so the thinking panel
      // can show the description the model saw when picking the tool.
      toolDescriptionByName.clear();
      for (const [name, desc] of Object.entries(chunk.data)) {
        if (typeof desc === "string" && desc.length > 0) {
          toolDescriptionByName.set(name, desc);
        }
      }
    } else if (
      // The AI SDK emits `tool-input-start` *before* it streams the input
      // deltas, and `tool-input-available` once the full input has been
      // parsed. Both carry the toolName for the same toolCallId — capture
      // from either, since `tool-input-available` can be skipped in some
      // edge cases (parse errors, providers that bypass delta streaming).
      // Without this fallback, the map miss leaves `name` undefined and
      // the issue-creation detection downstream silently no-ops.
      chunk.type === "tool-input-start" &&
      chunk.toolCallId !== undefined &&
      chunk.toolName !== undefined
    ) {
      toolNameById.set(chunk.toolCallId, chunk.toolName);
    } else if (
      chunk.type === "tool-input-delta" &&
      chunk.toolCallId !== undefined &&
      chunk.inputTextDelta !== undefined
    ) {
      const accumulated =
        (toolInputTextById.get(chunk.toolCallId) ?? "") + chunk.inputTextDelta;
      toolInputTextById.set(chunk.toolCallId, accumulated);
      if (
        exclusiveToolOutput &&
        toolNameById.get(chunk.toolCallId) === FINAL_ANSWER_TOOL
      ) {
        const content = readStreamingJsonStringProperty(accumulated, "content");
        const streamed = streamedFinalAnswerById.get(chunk.toolCallId) ?? "";
        if (content !== null && content.startsWith(streamed)) {
          const delta = content.slice(streamed.length);
          if (delta) {
            hasVisibleTextOutput = true;
            ctx.emit({ type: "token", text: delta });
            streamedFinalAnswerById.set(chunk.toolCallId, content);
          }
        }
      }
    } else if (
      chunk.type === "tool-input-available" &&
      chunk.toolCallId !== undefined &&
      chunk.toolName !== undefined
    ) {
      toolNameById.set(chunk.toolCallId, chunk.toolName);
      // final_answer is an output channel, not a visible tool — no chip.
      if (chunk.toolName === FINAL_ANSWER_TOOL) return;
      const toolInput =
        chunk.input && typeof chunk.input === "object"
          ? (chunk.input as Record<string, unknown>)
          : {};
      const description = toolDescriptionByName.get(chunk.toolName);
      // A "running" chip so the user sees live progress as the model
      // works — same UX as the kody-live runner path.
      ctx.emit({
        type: "tool-call",
        id: chunk.toolCallId,
        toolName: chunk.toolName,
        input: toolInput,
        status: "running",
        ...(description ? { description } : {}),
      });
    } else if (
      chunk.type === "tool-output-available" &&
      chunk.toolCallId !== undefined &&
      chunk.output !== undefined
    ) {
      const name = toolNameById.get(chunk.toolCallId);
      if (chunk.preliminary) {
        // AI SDK async-generator tools use preliminary results for progress.
        // Count them as transport activity while leaving the visible tool in
        // its running state; only the final result completes the tool.
        ctx.emit({ type: "reasoning", text: "\u200b" });
        return;
      }
      if (name === FINAL_ANSWER_TOOL) {
        // The final answer supersedes whatever streamed before it.
        if (isFinalAnswerOutput(chunk.output)) {
          committedFinalAnswer = true;
          hasVisibleTextOutput = true;
          ctx.emit({ type: "text-replace", text: chunk.output.content });
        }
        return;
      }
      const toolErrorText = getToolErrorMessage(chunk.output);
      if (toolErrorText) {
        // Errored tool outputs never carry directives — flag and stop.
        ctx.emit({
          type: "tool-result",
          id: chunk.toolCallId,
          ...(name !== undefined ? { toolName: name } : {}),
          output: chunk.output,
          isError: true,
          errorText: toolErrorText,
        });
        return;
      }
      // Any tool may emit a UI directive — match by shape, not by tool
      // name, so UI tools can remain thin. The surface defers application
      // until the stream settles (except render_view, applied inline).
      if (isSwitchAgentDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "switch-agent", payload: chunk.output },
        });
      }
      if (isDashboardNavigateDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "dashboard-navigate", payload: chunk.output },
        });
      }
      if (isPreviewActDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "preview-act", payload: chunk.output },
        });
      }
      if (isRenderedViewDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: {
            kind: "rendered-view",
            payload: chunk.output,
            presentation: hasVisibleTextOutput ? "append" : "replace",
          },
        });
        receivedRenderedView = true;
      }
      ctx.emit({
        type: "tool-result",
        id: chunk.toolCallId,
        ...(name !== undefined ? { toolName: name } : {}),
        output: chunk.output,
      });
    } else if (
      (chunk.type === "tool-output-error" ||
        chunk.type === "tool-input-error") &&
      chunk.toolCallId !== undefined
    ) {
      // Both malformed model arguments and execution failures can arrive as
      // stream-level errors. Preserve the provider's message instead of
      // reducing both cases to the generic "An error occurred." text.
      ctx.emit({
        type: "tool-result",
        id: chunk.toolCallId,
        isError: true,
        ...(typeof chunk.errorText === "string"
          ? { errorText: chunk.errorText }
          : {}),
      });
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });

    // Process complete SSE events (separated by blank lines).
    let sep: number;
    while ((sep = sseBuf.indexOf("\n\n")) !== -1) {
      const event = sseBuf.slice(0, sep);
      sseBuf = sseBuf.slice(sep + 2);
      if (!event.startsWith("data:")) continue;
      const payload = event.slice(5).trim();
      if (payload === "[DONE]") {
        sawTerminal = true;
        continue;
      }
      if (!payload) continue;
      const chunk = parseKodyDirectChunk(payload);
      if (!chunk) continue; // skip malformed
      try {
        applyChunk(chunk);
      } catch {
        // Ignore malformed chunks rather than aborting the stream.
      }
      if (receivedRenderedView) break;
    }
    if (receivedRenderedView) {
      // A rendered view is the completed user-facing result for this turn.
      // Do not leave the UI waiting when a provider keeps the stream open.
      sawTerminal = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  if (!sawTerminal && ctx.signal?.aborted !== true) {
    // EOF with no `finish`, `[DONE]`, or stream error: the connection
    // dropped mid-turn. Surface it — matching the brain adapter's
    // exhaustion semantics — instead of settling as a clean finish.
    throw new KodyDirectConnectionDroppedError();
  }
  ctx.emit({ type: "done" });
}

/**
 * ChatTransport wrapper. The turn config rides in `input.context`
 * (callers build it with `satisfies KodyDirectTurnConfig`).
 */
export const kodyDirectTransport: ChatTransport = {
  id: "kody-direct",
  async send(input, ctx) {
    if (!isKodyDirectTurnConfig(input.context)) {
      throw new Error(
        "kodyDirectTransport.send requires a KodyDirectTurnConfig in input.context",
      );
    }
    const prepared = compilePreparedTurnPayload(input.preparedTurn);
    const configured = input.context.body.messages;
    const configuredMessages = Array.isArray(configured) ? configured : [];
    const current = configuredMessages.at(-1) ?? {
      role: "user",
      content: prepared.currentMessage,
    };
    await sendKodyDirectTurn(
      {
        ...input.context,
        body: {
          ...input.context.body,
          messages: [...prepared.messages.slice(0, -1), current],
          conversationSummary: prepared.summary ?? undefined,
          agentHandoffContext: prepared.previousAgentContext ?? undefined,
          agentSlug: prepared.speaker.slug,
          conversationId: input.sessionId,
          turnId: input.turnId,
          conversationAgent: prepared.speaker,
        },
      },
      ctx,
    );
  },
};
