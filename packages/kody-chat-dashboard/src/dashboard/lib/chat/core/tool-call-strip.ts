/**
 * @fileType utility
 * @domain kody
 * @pattern tool-call-markup-stripper
 * @ai-summary Strips tool-call XML markup (`<tool_name />` and
 *   `<tool_call>…</tool_call>` blocks) from assistant text so the model
 *   can't leak its tool invocation syntax into the user-visible bubble.
 *   The structured call is captured separately as a `ToolCall` and
 *   surfaced via `ThinkingPanel`; the inline markup is just noise.
 */

import { parseReasoning } from "./reasoning";

/**
 * Names of tools the kody agents expose. Tags whose name matches any
 * entry here (self-closing or open/close pair) are stripped from the
 * visible text. Sourced from `src/dashboard/lib/agents.ts` and the
 * issue-creation tool-name set in `kody-chat-types.ts`.
 */
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "kody_run_issue",
  "kody_fix_pr",
  "kody_fix_ci_pr",
  "kody_review_pr",
  "kody_resolve_pr",
  "kody_revert_pr",
  "kody_sync_pr",
  "request_release",
  "report_bug",
  "create_feature",
  "create_enhancement",
  "create_refactor",
  "create_documentation",
  "create_chore",
  "read_capability_creation_guide",
  "create_or_update_capability",
  "create_kody_agent",
  "github_search_code",
  "github_get_file",
  "github_blame",
  "github_list_issues",
  "github_get_issue",
  "github_get_pull_request",
  "list_dashboard_features",
  "describe_feature",
  "switch_agent",
  "remote_write",
  "remote_read",
  "remote_bash",
  "github_close_issue",
  "github_create_issue",
  "remember",
  "recall",
  "update_memory",
  "preview_act",
  "show_view",
  "final_answer",
  "read_capability_creation_guide",
]);

/**
 * `<tool_call>…</tool_call>` (closed or unclosed-tail). The unclosed form
 * handles streaming — when the model has emitted the opening tag but
 * not the close, we still strip the partial so the bubble doesn't blink
 * on raw XML.
 */
const TOOL_CALL_BLOCK_RE =
  /<\s*tool_call\b[^>]*>[\s\S]*?(?:<\s*\/\s*tool_call\s*>|$)/gi;

/**
 * Some OpenAI-compatible providers emit tool invocations as
 * `<invoke name="tool">…</invoke>` in text/reasoning deltas instead of
 * SDK-native tool-call chunks. Treat the whole block as tool traffic.
 */
const PROVIDER_INVOKE_BLOCK_RE =
  /<\s*invoke\b[^>]*>[\s\S]*?(?:<\s*\/\s*invoke\s*>\s*|$)/gi;

/**
 * MiniMax can emit its native tool token into a text or reasoning delta
 * instead of returning an SDK tool call. The payload has no closing marker,
 * so everything after the token belongs to the unexecuted invocation.
 */
const PROVIDER_TOOL_CALL_TOKEN_RE = /<\|tool_call\|?>[\s\S]*$/gi;

/**
 * Provider channel separators can appear between streamed XML fragments,
 * for example `]<]minimax[>[`. They are transport noise, not answer text.
 */
const PROVIDER_CHANNEL_SEPARATOR_RE = /\]<\][a-z0-9_-]+\[>\[/gi;

/**
 * Some providers serialize an output-tool call as ordinary assistant text
 * instead of an SDK tool event. Only unwrap the complete, anchored envelope;
 * prose that merely mentions `final_answer` must remain untouched.
 */
const PLAIN_FINAL_ANSWER_ENVELOPE_RE = /^\s*final_answer\s+([\s\S]+?)\s*$/i;

function unwrapPlainFinalAnswerEnvelope(text: string): {
  text: string;
  unwrapped: boolean;
} {
  const match = PLAIN_FINAL_ANSWER_ENVELOPE_RE.exec(text);
  if (!match) return { text, unwrapped: false };
  try {
    const payload = JSON.parse(match[1]!) as { content?: unknown };
    return typeof payload.content === "string"
      ? { text: payload.content, unwrapped: true }
      : { text, unwrapped: false };
  } catch {
    return { text, unwrapped: false };
  }
}

/**
 * Self-closing tag (`<name … />`) — capture the tag name so we can
 * filter by `KNOWN_TOOL_NAMES`.
 */
const SELF_CLOSING_TAG_RE = /<\s*([a-zA-Z_][\w-]*)\b[^>]*?\/\s*>/g;

const TAG_NAME_RE = /^<\s*([a-zA-Z_][\w-]*)/;

/**
 * Recognized tag-name prefixes for dangling-tail handling. Includes
 * `tool_call` (for the block form) in addition to the tool names so
 * `<tool_cal…` is recognized as a partial that should be hidden.
 */
const DANGLING_TAG_NAMES: readonly string[] = [
  ...KNOWN_TOOL_NAMES,
  "tool_call",
];

function stripToolCallBlocks(text: string): string {
  return text
    .replace(TOOL_CALL_BLOCK_RE, "")
    .replace(PROVIDER_INVOKE_BLOCK_RE, "")
    .replace(PROVIDER_TOOL_CALL_TOKEN_RE, "");
}

function stripSelfClosingToolTags(text: string): string {
  return text.replace(SELF_CLOSING_TAG_RE, (full, name: string) => {
    return KNOWN_TOOL_NAMES.has(name) ? "" : full;
  });
}

const BARE_TOOL_NAME_LINE_RE = new RegExp(
  `(^|\\n)\\s*(?:${[...KNOWN_TOOL_NAMES]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&"))
    .join("|")})\\s*[.:]?\\s*(?=\\n|$)`,
  "g",
);

/** Some providers emit a tool name as a plain line before the real answer. */
function stripBareToolNameLines(text: string): string {
  return text
    .replace(BARE_TOOL_NAME_LINE_RE, "$1")
    // A provider can leave the call terminator behind after the tool name.
    // A punctuation-only line is transport noise, never useful answer prose.
    .replace(/(^|\n)\s*["'`“”‘’]*[.:]["'`“”‘’]*\s*(?=\n|$)/g, "$1");
}

/**
 * If the text ends with a `<` followed by an unfinished tag whose name
 * is or could grow into a known tool name, drop the partial. This keeps
 * the cursor from blinking on `<kody_run_issu` or `<tool_cal` while the
 * stream is still arriving.
 */
function stripDanglingToolTagTail(text: string): string {
  const lt = text.lastIndexOf("<");
  if (lt === -1) return text;
  const tail = text.slice(lt);
  if (tail.includes(">")) return text;
  const m = tail.match(TAG_NAME_RE);
  if (!m) return text;
  const partial = m[1];
  for (const name of DANGLING_TAG_NAMES) {
    if (name.startsWith(partial)) return text.slice(0, lt);
  }
  return text;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

const FINAL_ANSWER_MARKER_RE =
  /(?:^|\n)\s*(?:final\s+answer|final|answer)\s*:\s*/i;
const LEADING_ANSWER_MARKER_RE = /^\s*(?:final\s+answer|final|answer)\s*:\s*/i;
const SCRATCHPAD_LABEL_RE =
  /^\s*(?:analysis|reasoning|thinking|thoughts?|scratchpad)\s*[:.-]/i;
// First/second-person reasoning preambles the model commonly emits as raw
// prose (without `<think>` tags) before the actual answer. The matching
// happens at the START of the text and is gated by a blank-line separator
// + non-empty rest in `stripLeakedReasoning` — that double gate keeps
// legitimate first-person questions like "I need one detail before I
// can run this safely: which branch should I use?" untouched.
const THINKING_PREAMBLE_RE = new RegExp(
  [
    String.raw`^\s*let\s+me\s+(?:think|consider|analyze|figure\s+out|check|look|see|examine|start|walk\s+through)`,
    String.raw`^\s*I\s+(?:need|should|will|must|can|have\s+to|want\s+to)\s+(?:to\s+)?(?:think|consider|analyze|figure\s+out|check|look|see|examine|start|decide|review)`,
    String.raw`^\s*(?:first|next|now|alright|ok(?:ay)?|so),?\s+(?:let'?s|let\s+me|I\s+(?:need|should|will|must|can|have\s+to))`,
    String.raw`^\s*the\s+user\s+(?:is\s+)?(?:asking|wants?|needs?|requested|mentioned|provided|sent)`,
    String.raw`^\s*looking\s+at\s+(?:the\s+)?(?:request|question|issue|user|code|file|task|repo|error|stack\s*trace)`,
    String.raw`^\s*(?:step|plan)\s*\d+\s*[:.-]`,
  ].join("|"),
  "i",
);

function stripLeadingAnswerMarker(text: string): string {
  return text.replace(LEADING_ANSWER_MARKER_RE, "").trim();
}

function looksLikeLeakedReasoning(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SCRATCHPAD_LABEL_RE.test(trimmed)) return true;
  if (THINKING_PREAMBLE_RE.test(trimmed)) return true;

  return (
    /^(?:the user|user|they)\b/i.test(trimmed) &&
    /\bI\s+(?:need|should|will|must|can|have to)\b/i.test(trimmed)
  );
}

function equivalentWhitespacePrefixLength(
  text: string,
  expectedPrefix: string,
): number | null {
  let textIndex = 0;
  let prefixIndex = 0;

  while (prefixIndex < expectedPrefix.length) {
    const prefixChar = expectedPrefix[prefixIndex];
    const textChar = text[textIndex];
    if (textChar === undefined) return null;

    if (/\s/.test(prefixChar)) {
      if (!/\s/.test(textChar)) return null;
      while (/\s/.test(expectedPrefix[prefixIndex] ?? "")) prefixIndex += 1;
      while (/\s/.test(text[textIndex] ?? "")) textIndex += 1;
      continue;
    }

    if (textChar !== prefixChar) return null;
    prefixIndex += 1;
    textIndex += 1;
  }

  return textIndex;
}

function stripDuplicatedReasoningPrefix(
  answer: string,
  reasoning: string,
): { text: string; stripped: boolean } {
  const trimmedReasoning = reasoning.trim();
  if (!trimmedReasoning) return { text: answer, stripped: false };

  const leadingWhitespace = answer.match(/^\s*/)?.[0] ?? "";
  const rest = answer.slice(leadingWhitespace.length);
  const duplicateLength = equivalentWhitespacePrefixLength(
    rest,
    trimmedReasoning,
  );
  if (duplicateLength === null) {
    return { text: answer, stripped: false };
  }
  const reasoningEnd = trimmedReasoning.at(-1) ?? "";
  const answerRemainderStart = rest[duplicateLength] ?? "";
  if (
    /[\p{L}\p{N}_]/u.test(reasoningEnd) &&
    /[\p{L}\p{N}_]/u.test(answerRemainderStart)
  ) {
    return { text: answer, stripped: false };
  }

  return {
    text: rest.slice(duplicateLength).trim(),
    stripped: true,
  };
}

function appendLeaked(collected: string, next: string): string {
  const trimmed = next.trim();
  if (!trimmed) return collected;
  return collected ? `${collected}\n\n${trimmed}` : trimmed;
}

function stripLeakedReasoning(
  answer: string,
  reasoning: string,
): { text: string; leaked: string } {
  const duplicate = stripDuplicatedReasoningPrefix(answer, reasoning);
  let working = duplicate.text;
  let leaked = "";
  if (duplicate.stripped) {
    // The duplicated prefix is by definition leaked reasoning — it
    // already lives in `reasoning`, so reuse the trimmed duplicate text
    // rather than rescanning. Then peel any "Final answer:" marker that
    // was inlined into the duplicate.
    working = stripLeadingAnswerMarker(working);
  }

  const trimmed = working.trim();

  // "Final answer:" / "Answer:" marker — strip everything before it when
  // the preamble is recognisably thinking.
  const marker = FINAL_ANSWER_MARKER_RE.exec(trimmed);
  if (marker && marker.index > 0) {
    const beforeMarker = trimmed.slice(0, marker.index);
    if (looksLikeLeakedReasoning(beforeMarker)) {
      return {
        text: trimmed.slice(marker.index + marker[0].length).trim(),
        leaked: appendLeaked(leaked, beforeMarker),
      };
    }
  }

  // Multi-segment thinking. The model often narrates a chain of thought
  // across several paragraphs ("Let me think about X.\n\nAnswer for X.\n\n
  // Now let me think about Y.\n\nAnswer for Y.") — the chat only has ONE
  // ReasoningPanel at the top, so anything after the first thinking
  // segment would otherwise stay in the reply bubble. Sweep every blank-
  // line-separated paragraph and move any recognisably-thinking ones into
  // the reasoning. Guard: only strip if at least one non-thinking
  // paragraph remains, so an all-thinking reply is never silenced.
  const swept = stripAllLeakedParagraphs(trimmed);
  if (swept.leaked) {
    return {
      text: swept.text,
      leaked: appendLeaked(leaked, swept.leaked),
    };
  }

  return { text: trimmed, leaked };
}

function stripAllLeakedParagraphs(text: string): {
  text: string;
  leaked: string;
} {
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length < 2) return { text, leaked: "" };

  const thinkingFlags = paragraphs.map((p) => {
    const trimmed = p.trim();
    return trimmed.length > 0 && looksLikeLeakedReasoning(trimmed);
  });
  const hasNonThinking = thinkingFlags.some((t) => !t);
  if (!hasNonThinking) return { text, leaked: "" };

  const kept: string[] = [];
  const leaked: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (thinkingFlags[i]) {
      const trimmed = paragraphs[i].trim();
      if (trimmed) leaked.push(trimmed);
    } else {
      kept.push(paragraphs[i]);
    }
  }

  return {
    text: kept.join("\n\n").trim(),
    leaked: leaked.join("\n\n").trim(),
  };
}

/**
 * Remove the model-emitted tool-call markup from `text` so the visible
 * answer bubble shows prose only. Safe on empty / plain input (returns
 * the input unchanged for `null`/empty/strings without tool markup).
 */
/**
 * True when `text` contains tool-call markup the model wrote as PLAIN
 * TEXT (a `<tool_call>`/`<invoke>` block, or a self-closing known tool
 * tag). Such a "call" never executed — no server-side tool ran. Used to
 * warn instead of stripping silently. Deliberately ignores channel
 * separators, dangling stream tails, and blank-line noise: those are
 * transport artifacts, not fabricated invocations.
 */
export function containsToolCallMarkup(
  ...textParts: Array<string | null | undefined>
): boolean {
  for (const text of textParts) {
    if (!text) continue;
    if (new RegExp(TOOL_CALL_BLOCK_RE.source, "i").test(text)) return true;
    if (new RegExp(PROVIDER_INVOKE_BLOCK_RE.source, "i").test(text))
      return true;
    if (new RegExp(PROVIDER_TOOL_CALL_TOKEN_RE.source, "i").test(text)) {
      return true;
    }
    const selfClosing = new RegExp(SELF_CLOSING_TAG_RE.source, "g");
    for (let m = selfClosing.exec(text); m; m = selfClosing.exec(text)) {
      if (KNOWN_TOOL_NAMES.has(m[1])) return true;
    }
  }
  return false;
}

export function stripToolCallMarkup(text: string): string {
  if (!text) return text;
  let result = stripToolCallBlocks(text);
  result = result.replace(PROVIDER_CHANNEL_SEPARATOR_RE, "");
  result = stripSelfClosingToolTags(result);
  result = stripDanglingToolTagTail(result);
  result = collapseBlankLines(result);
  return result.trim();
}

/**
 * Parse assistant content into hidden reasoning and the visible answer,
 * additionally stripping tool-call markup from the answer. Used by the
 * chat bubble renderer; the underlying `parseReasoning` is left alone
 * so model-loop code (which intentionally preserves the tool-call
 * markup for context) is unaffected.
 */
export function parseAssistantContent(raw: string): {
  reasoning: string;
  answer: string;
  /**
   * True when tool-call markup was stripped from the ANSWER text. The
   * model wrote a tool invocation as plain text — nothing executed. The
   * bubble renderer surfaces a warning instead of hiding it silently:
   * silent stripping made fabricated "saved with id X" replies look
   * identical to real ones (real incident — no data was ever written).
   */
  strippedToolMarkup: boolean;
} {
  if (!raw) return { reasoning: "", answer: "", strippedToolMarkup: false };
  const { reasoning, answer } = parseReasoning(raw);
  const sanitizedReasoning = stripToolCallMarkup(reasoning);
  const unwrappedAnswer = unwrapPlainFinalAnswerEnvelope(answer);
  // `final_answer` is a side-effect-free output channel, so unwrapping its
  // provider envelope must not trigger the fabricated-action warning.
  const strippedToolMarkup = containsToolCallMarkup(reasoning, answer);
  const { text, leaked } = stripLeakedReasoning(
    stripBareToolNameLines(stripToolCallMarkup(unwrappedAnswer.text)),
    sanitizedReasoning,
  );
  const combinedReasoning = leaked
    ? sanitizedReasoning
      ? `${sanitizedReasoning}\n\n${leaked}`
      : leaked
    : sanitizedReasoning;
  return { reasoning: combinedReasoning, answer: text, strippedToolMarkup };
}
