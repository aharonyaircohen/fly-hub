/**
 * Pure conversation-compaction policy shared by every chat transport.
 * The visible transcript remains the source of truth; checkpoints are
 * derived model memory and are discarded whenever their source prefix changes.
 */

export const DEFAULT_COMPACTION_TRIGGER_TOKENS = 24_000;
export const DEFAULT_COMPACTION_RECENT_TOKENS = 8_000;

export interface CompactableMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationCheckpoint {
  version: 1;
  revision: number;
  summary: string;
  throughMessageCount: number;
  sourceFingerprint: string;
  createdAt: string;
}

export interface ConversationCompactionPlan {
  previousSummary?: string;
  messagesToSummarize: CompactableMessage[];
  recentMessages: CompactableMessage[];
  throughMessageCount: number;
  previousRevision: number;
}

/**
 * Provider tokenizers differ, so this deliberately uses a stable conservative
 * estimate: roughly four text characters per token plus message framing.
 */
export function estimateConversationTokens(
  messages: readonly CompactableMessage[],
): number {
  return messages.reduce(
    (total, item) => total + Math.ceil(item.content.length / 4) + 4,
    0,
  );
}

function fingerprintMessages(
  messages: readonly CompactableMessage[],
  throughMessageCount: number,
): string {
  let hash = 0x811c9dc5;
  const prefix = messages.slice(0, throughMessageCount);
  for (const item of prefix) {
    const value = `${item.role}\u0000${item.content}\u0001`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(36);
}

function validCheckpoint(
  messages: readonly CompactableMessage[],
  checkpoint: ConversationCheckpoint | null | undefined,
): ConversationCheckpoint | null {
  if (!checkpoint || checkpoint.version !== 1) return null;
  if (
    checkpoint.throughMessageCount < 1 ||
    checkpoint.throughMessageCount > messages.length
  ) {
    return null;
  }
  return fingerprintMessages(messages, checkpoint.throughMessageCount) ===
    checkpoint.sourceFingerprint
    ? checkpoint
    : null;
}

export function buildConversationContext(
  messages: readonly CompactableMessage[],
  checkpoint?: ConversationCheckpoint | null,
): {
  summary: string | null;
  recentMessages: CompactableMessage[];
  checkpoint: ConversationCheckpoint | null;
} {
  const current = validCheckpoint(messages, checkpoint);
  if (!current) {
    return { summary: null, recentMessages: [...messages], checkpoint: null };
  }
  return {
    summary: current.summary,
    recentMessages: messages.slice(current.throughMessageCount),
    checkpoint: current,
  };
}

export function planConversationCompaction(args: {
  messages: readonly CompactableMessage[];
  checkpoint?: ConversationCheckpoint | null;
  nextUserContent: string;
  force?: boolean;
  triggerTokens?: number;
  recentTokens?: number;
}): ConversationCompactionPlan | null {
  const triggerTokens = args.triggerTokens ?? DEFAULT_COMPACTION_TRIGGER_TOKENS;
  const recentTokens = args.recentTokens ?? DEFAULT_COMPACTION_RECENT_TOKENS;
  const context = buildConversationContext(args.messages, args.checkpoint);
  const renderedTokens =
    estimateConversationTokens(context.recentMessages) +
    (context.summary ? Math.ceil(context.summary.length / 4) + 4 : 0) +
    Math.ceil(args.nextUserContent.length / 4) +
    4;
  if (!args.force && renderedTokens < triggerTokens) return null;

  let retainedTokens = 0;
  let retainFromIndex = args.messages.length;
  let retainedCount = 0;
  while (
    retainFromIndex > 0 &&
    (retainedTokens < recentTokens || retainedCount < 2)
  ) {
    retainFromIndex -= 1;
    retainedCount += 1;
    retainedTokens += estimateConversationTokens([
      args.messages[retainFromIndex],
    ]);
  }

  const previousThrough = context.checkpoint?.throughMessageCount ?? 0;
  const throughMessageCount = Math.max(previousThrough, retainFromIndex);
  if (throughMessageCount <= previousThrough) return null;

  return {
    ...(context.summary ? { previousSummary: context.summary } : {}),
    messagesToSummarize: args.messages.slice(
      previousThrough,
      throughMessageCount,
    ),
    recentMessages: args.messages.slice(throughMessageCount),
    throughMessageCount,
    previousRevision: context.checkpoint?.revision ?? 0,
  };
}

export function createConversationCheckpoint(args: {
  summary: string;
  messages: readonly CompactableMessage[];
  throughMessageCount: number;
  previousRevision: number;
  createdAt?: string;
}): ConversationCheckpoint {
  return {
    version: 1,
    revision: args.previousRevision + 1,
    summary: args.summary.trim(),
    throughMessageCount: args.throughMessageCount,
    sourceFingerprint: fingerprintMessages(
      args.messages,
      args.throughMessageCount,
    ),
    createdAt: args.createdAt ?? new Date().toISOString(),
  };
}

export function prependConversationSummary(
  summary: string,
  userContent: string,
): string {
  return [
    "<conversation_summary>",
    summary.trim(),
    "</conversation_summary>",
    "",
    userContent,
  ].join("\n");
}
