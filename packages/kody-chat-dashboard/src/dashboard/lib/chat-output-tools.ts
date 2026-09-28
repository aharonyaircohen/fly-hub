export const FINAL_ANSWER_TOOL = "final_answer";
export const SHOW_VIEW_TOOL = "show_view";
export const CHAT_OUTPUT_CONTRACT_DATA_TYPE = "data-chat-output-contract";
export const EXCLUSIVE_TOOL_OUTPUT_MODE = "exclusive-tool";
export const CHAT_OUTPUT_TOOL_NAMES = [
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
] as const;

const TOOLLESS_RECOVERY_CONTENT =
  "I couldn't complete a reliable answer with this model. Would you like me to retry or use another model?";
const VIEW_RECOVERY_CONTENT =
  "I couldn't display that UI card. Would you like me to retry?";

/** Preserve useful prose when a provider cannot execute the required output tool. */
export function getToollessRecoveryContent(visibleAnswer: string): string {
  const answer = visibleAnswer.trim();
  return answer || TOOLLESS_RECOVERY_CONTENT;
}

export function getViewRecoveryContent(visibleAnswer: string): string {
  const answer = visibleAnswer.trim();
  return answer
    ? `${answer}\n\nWould you like me to retry?`
    : VIEW_RECOVERY_CONTENT;
}

export interface FinalAnswerOutput {
  content: string;
}

const EXACT_REPLY_ONLY_RE = /\breply\s+(?:with\s+)?only\s*:\s*(.+)$/i;

/** Enforce the user's exact-output boundary at the output-tool owner. */
export function normalizeExactOutputContent(
  content: string,
  userText?: string,
): string {
  const text = content.trim();
  const request = userText?.trim() ?? "";
  if (!request || !/\b(?:reply|respond|output)\b/i.test(request)) return text;

  const literal = request.match(EXACT_REPLY_ONLY_RE)?.[1]?.trim();
  if (literal) return literal.replace(/[.!?,;:]+$/u, "").trim();

  if (/\bno\s+punctuation\b/i.test(request)) {
    const lastLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    return (lastLine ?? text).replace(/[.!?,;:]+$/u, "").trim();
  }
  return text;
}

export interface ToolErrorOutput {
  error: string;
}

export const FINAL_ANSWER_INTERACTION_ERROR =
  "This answer still asks the user for input or a decision. Use show_view with an editable form, choice, or confirmation control instead.";
export const FINAL_ANSWER_FOLLOW_UP_ERROR =
  "This prose answer must end with one short, relevant follow-up question. Retry final_answer without adding or changing a renderer.";

export function finalAnswerEndsWithFollowUpQuestion(content: string): boolean {
  return /\?\s*$/.test(content.trim());
}

/** Exact-output instructions own the response shape and must not be decorated. */
export function shouldRequireFollowUpQuestion(
  userText: string | null | undefined,
): boolean {
  const text = userText?.trim() ?? "";
  return !(
    /\b(?:please\s+)?(?:proceed|continue|work|run|execute|monitor|watch)\s+autonomously\b/i.test(
      text,
    ) ||
    /\b(?:keep|continue)\s+(?:working|going|watching|monitoring)\b/i.test(
      text,
    ) ||
    /\b(?:do\s+not|don't)\s+(?:stop|pause|ask\s+(?:me\s+)?(?:again|for\s+(?:approval|confirmation)))\b/i.test(
      text,
    ) ||
    /\breply\b[^.!?\n]{0,120}\bonly\b/i.test(text) ||
    /\b(?:return|respond|output)\s+exactly\b/i.test(text) ||
    /\bnothing else\b/i.test(text) ||
    /\b(?:one|two|three|four|five)\s+(?:short\s+)?(?:plain(?:[- ]text)?\s+)?(?:sentence|sentences|word|words|bullet\s+points?)\b/i.test(
      text,
    ) ||
    /\b(?:no|without|do not|don't)\s+(?:a\s+)?follow[- ]?up\s+question\b/i.test(
      text,
    ) ||
    /\bplain[- ]text\s+only\b/i.test(text) ||
    /\b(?:just|only)\s+tell\s+me\b/i.test(text)
  );
}

/** A final answer cannot be final when it still asks the user to act. */
export function finalAnswerRequestsInteraction(content: string): boolean {
  const text = content.trim();
  return (
    /\b(?:would|could|can|do|will) you\s+(?:approve|confirm|choose|select|provide|share|pick|enter|upload|submit|authorize)\b[^.!?]{0,180}\?/i.test(
      text,
    ) ||
    /\bif you (?:can )?(?:provide|share|choose|select|confirm|approve|pick|enter)\b/i.test(
      text,
    ) ||
    /(?:^|[.!?]\s+)(?:please\s+)?(?:provide|share|choose|select|confirm|approve|pick|enter)\b/i.test(
      text,
    ) ||
    /\b(?:let me know|tell me)\b/i.test(text)
  );
}

/**
 * Direct-chat output policy sent before model chunks.
 *
 * In exclusive-tool mode, provider text deltas are draft material. Exactly
 * one output tool owns the visible reply: `final_answer` commits text and
 * `show_view` commits a rendered view. This prevents an already-visible draft
 * from disappearing when the model selects a renderer later in the turn.
 */
export interface ChatOutputContract {
  mode: typeof EXCLUSIVE_TOOL_OUTPUT_MODE;
}

export function isExclusiveToolOutputContract(
  value: unknown,
): value is ChatOutputContract {
  if (!value || typeof value !== "object") return false;
  return (value as { mode?: unknown }).mode === EXCLUSIVE_TOOL_OUTPUT_MODE;
}

export function getFinalAnswerContent(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const content = (input as { content?: unknown }).content;
  return typeof content === "string" && content.trim().length > 0
    ? content
    : null;
}

export function isFinalAnswerOutput(
  output: unknown,
): output is FinalAnswerOutput {
  return getFinalAnswerContent(output) !== null;
}

export function getToolErrorMessage(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim().length > 0 ? error : null;
}

export function isToolErrorOutput(output: unknown): output is ToolErrorOutput {
  return getToolErrorMessage(output) !== null;
}

type ToolResultStep = Readonly<{
  toolResults: readonly Readonly<{ toolName: string; output: unknown }>[];
}>;

export function hasSuccessfulRenderedViewResult(
  steps: readonly ToolResultStep[],
): boolean {
  return (
    steps
      .at(-1)
      ?.toolResults.some((result) => isRenderedViewDirective(result.output)) ??
    false
  );
}

export function hasVisibleChatToolOutput(
  steps: readonly ToolResultStep[],
): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (result) =>
        isRenderedViewDirective(result.output) ||
        ((result.toolName === SHOW_VIEW_TOOL ||
          result.toolName === FINAL_ANSWER_TOOL) &&
          !isToolErrorOutput(result.output)),
    ),
  );
}

/**
 * Per-step tool choice. When a step is locked to `show_view` alone, pin
 * the tool by name — some providers (observed: MiniMax-M3) ignore the
 * generic "required" and finish with prose, ending the turn with no
 * visible output. Pinning the specific function is honored far more
 * reliably.
 */
export function selectChatOutputToolChoice<T extends string>(
  activeTools: readonly T[],
  capabilities: {
    supportsRequiredToolChoice?: boolean;
    supportsNamedToolChoice?: boolean;
  } = {},
): { type: "tool"; toolName: T } | "required" | "auto" {
  const supportsRequired = capabilities.supportsRequiredToolChoice !== false;
  const supportsNamed = capabilities.supportsNamedToolChoice !== false;

  if (
    supportsNamed &&
    activeTools.length === 1 &&
    activeTools[0] === SHOW_VIEW_TOOL
  ) {
    return { type: "tool", toolName: activeTools[0] };
  }

  return supportsRequired ? "required" : "auto";
}

export function selectChatOutputActiveTools<T extends string>({
  toolNames,
  requireViewOutput,
  allowPreRenderTools,
}: {
  toolNames: readonly T[];
  requireViewOutput: boolean;
  allowPreRenderTools: boolean;
}): T[] {
  const showViewOnly = toolNames.filter((name) => name === SHOW_VIEW_TOOL);
  if (requireViewOutput) {
    return allowPreRenderTools
      ? toolNames.filter((name) => name !== FINAL_ANSWER_TOOL)
      : showViewOnly;
  }
  return [...toolNames];
}

export function shouldRetryToollessTurn({
  producedOutputTool,
  visibleAnswer,
  enforceToolOutput,
  retryCount,
  maxRetries,
}: {
  producedOutputTool: boolean;
  visibleAnswer: string;
  enforceToolOutput: boolean;
  retryCount: number;
  maxRetries: number;
}): boolean {
  if (producedOutputTool || retryCount >= maxRetries) return false;
  return enforceToolOutput || visibleAnswer.length === 0;
}
import { isRenderedViewDirective } from "./chat-ui-actions";
