import type { PreparedConversationTurn } from "./prepare-turn";

export type PreparedWireMessage = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

export function compilePreparedTurnPayload(turn: PreparedConversationTurn): {
  messages: readonly PreparedWireMessage[];
  currentMessage: string;
  previousAgentContext: string | null;
  summary: string | null;
  speaker: PreparedConversationTurn["speaker"];
} {
  const messages = [
    ...turn.activeHistory.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: turn.currentMessage.role,
      content: turn.currentMessage.content,
    },
  ];
  const previousAgentContext =
    turn.previousAgentContext.length > 0
      ? [
          "Background from the conversation before the current agent handoff.",
          "Use it only as context; answer the current user message as the selected agent.",
          ...turn.previousAgentContext.map(
            (message) => `${message.role}: ${message.content}`,
          ),
        ].join("\n")
      : null;
  return {
    messages,
    currentMessage: turn.currentMessage.content,
    previousAgentContext,
    summary: turn.summary,
    speaker: turn.speaker,
  };
}
