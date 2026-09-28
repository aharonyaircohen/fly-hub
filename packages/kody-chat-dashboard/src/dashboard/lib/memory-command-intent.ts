const EXPLICIT_MEMORY_COMMANDS = [
  /^\s*(?:please\s+)?remember\b/iu,
  /^\s*(?:please\s+)?(?:save|store)\s+(?:this|that)\b/iu,
  /^\s*(?:בבקשה\s+)?(?:תזכור|תזכרי|שמור|שמרי)/u,
] as const;

const CONVERSATION_ONLY_SCOPE =
  /\b(?:for|in|only\s+in)\s+(?:this|current|the(?:\s+current)?)\s+(?:conversation|chat|thread|session)\b/iu;

export const CONVERSATION_ONLY_MEMORY_INSTRUCTION =
  "The user is referring only to the current conversation transcript. Conversation-only context is automatic: acknowledge the requested temporary context using the user's requested output, and recall it from visible messages in later turns. Do not call, require, or mention durable memory tools. This is not a durable-memory write, so do not claim the information was saved beyond this conversation.";

export function isConversationOnlyMemoryRequest(
  text: string | null | undefined,
): boolean {
  return Boolean(text && CONVERSATION_ONLY_SCOPE.test(text));
}

export interface ConversationMessageForMemoryScope {
  role: string;
  content: string;
}

/** Keep conversation-only context active until a later durable write is explicit. */
export function hasActiveConversationOnlyMemoryScope(
  messages: readonly ConversationMessageForMemoryScope[],
): boolean {
  let active = false;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (isConversationOnlyMemoryRequest(message.content)) {
      active = true;
    } else if (active && hasExplicitMemoryCommand(message.content)) {
      active = false;
    }
  }
  return active;
}

export function hasExplicitMemoryCommand(text: string | null): boolean {
  if (!text) return false;
  if (isConversationOnlyMemoryRequest(text)) return false;
  return EXPLICIT_MEMORY_COMMANDS.some((pattern) => pattern.test(text));
}
