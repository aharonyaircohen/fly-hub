import type { Message } from "./kody-chat-types";

/** Update the newest active assistant bubble, which is the current turn surface. */
export function updateActiveAssistant(
  messages: Message[],
  update: (message: Message) => Message,
): Message[] {
  const index = messages.findLastIndex(
    (message) => message.role === "assistant" && message.isLoading,
  );
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = update(next[index]);
  return next;
}

/** Complete the current assistant surface without touching older messages. */
export function completeActiveAssistant(messages: Message[]): Message[] {
  return updateActiveAssistant(messages, (message) => ({
    ...message,
    isLoading: false,
  }));
}

/** Settle every active assistant and expose the exact records to persist. */
export function settleActiveAssistants(messages: Message[]): {
  messages: Message[];
  settled: Message[];
} {
  const settled: Message[] = [];
  const next = messages.map((message) => {
    if (message.role !== "assistant" || !message.isLoading) return message;
    const completed = { ...message, isLoading: false };
    settled.push(completed);
    return completed;
  });
  return { messages: next, settled };
}

/** Remove only the current assistant surface when a turn is cancelled. */
export function removeActiveAssistant(messages: Message[]): Message[] {
  const index = messages.findLastIndex(
    (message) => message.role === "assistant" && message.isLoading,
  );
  return index < 0
    ? messages
    : messages.filter((_, itemIndex) => itemIndex !== index);
}

/** Remove the current surface and append one canonical error bubble. */
export function replaceActiveAssistantWithError(
  messages: Message[],
  content: string,
): Message[] {
  return [
    ...messages.filter(
      (message) => !(message.role === "assistant" && message.isLoading),
    ),
    { role: "assistant", content, isLoading: false, isError: true },
  ];
}
