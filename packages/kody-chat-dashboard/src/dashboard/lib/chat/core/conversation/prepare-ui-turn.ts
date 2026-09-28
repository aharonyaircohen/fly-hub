import type { SessionMeta } from "../../../chat-types";
import {
  prepareConversationTurn,
  type AgentIdentity,
  type Conversation,
  type ConversationEntry,
  type ConversationRuntime,
  type PreparedConversationTurn,
} from "./prepare-turn";

type CurrentMessage = Readonly<{
  id: string;
  content: string;
  timestamp: string;
}>;
type UiMessage = Readonly<{
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}>;

export function prepareUiConversationTurn(input: {
  session: SessionMeta;
  messages: readonly UiMessage[];
  current: CurrentMessage;
  runtime: ConversationRuntime;
}): PreparedConversationTurn {
  const activeAgent = input.session.agencyAgent ?? {
    slug: "kody",
    title: "Kody",
  };
  const handoffs = input.session.agentHandoffs ?? [];
  const firstAgent: AgentIdentity = handoffs[0]
    ? {
        slug: handoffs[0].fromSlug,
        title: handoffs[0].fromTitle,
      }
    : activeAgent;
  const timeline: Array<
    | { type: "message"; timestamp: string; message: UiMessage; index: number }
    | {
        type: "handoff";
        timestamp: string;
        handoff: (typeof handoffs)[number];
        index: number;
      }
  > = [
    ...input.messages.map((message, index) => ({
      type: "message" as const,
      timestamp: message.timestamp ?? input.session.createdAt,
      message,
      index,
    })),
    ...handoffs.map((handoff, index) => ({
      type: "handoff" as const,
      timestamp: handoff.switchedAt,
      handoff,
      index,
    })),
  ].sort(
    (left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
      (left.type === "message" ? 0 : 1) - (right.type === "message" ? 0 : 1) ||
      left.index - right.index,
  );

  let speakingAgent = firstAgent;
  const entries: ConversationEntry[] = timeline.map((item, seq) => {
    if (item.type === "handoff") {
      const from = {
        slug: item.handoff.fromSlug,
        title: item.handoff.fromTitle,
      };
      const to = {
        slug: item.handoff.toSlug,
        title: item.handoff.toTitle,
      };
      speakingAgent = to;
      return {
        kind: "agent-handoff",
        id: item.handoff.id,
        seq,
        from,
        to,
        createdAt: item.handoff.switchedAt,
      };
    }
    return {
      kind: "message",
      id: item.message.id ?? `legacy-${item.index}`,
      seq,
      role: item.message.role,
      author:
        item.message.role === "user"
          ? { kind: "user", actorId: "current-user" }
          : { kind: "agent", ...speakingAgent },
      content: item.message.content,
      status: "committed",
      createdAt: item.timestamp,
    };
  });
  entries.push({
    kind: "message",
    id: input.current.id,
    seq: entries.length,
    role: "user",
    author: { kind: "user", actorId: "current-user" },
    content: input.current.content,
    status: "committed",
    createdAt: input.current.timestamp,
  });
  const conversation: Conversation = {
    id: input.session.id,
    scope: { kind: "global" },
    title: input.session.title,
    activeAgent,
    runtime: input.runtime,
    createdAt: input.session.createdAt,
    updatedAt: input.current.timestamp,
  };
  return prepareConversationTurn({
    conversation,
    entries,
    currentMessageId: input.current.id,
  });
}
