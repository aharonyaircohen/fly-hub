import type { AgencyAgentIdentity, ChatMessage } from "../../../chat-types";
import type { ConversationClient } from "./conversation-client";

export type AssistantMessagePersistenceMode =
  "append-committed" | "append-pending" | "settle-pending";

type AssistantMessage = ChatMessage & { id: string; role: "assistant" };

function storedAttachmentId(id: string): string {
  return id.includes("::") ? id.slice(id.indexOf("::") + 2) : id;
}

export async function persistAssistantConversationMessage(input: {
  client: ConversationClient;
  actorLogin: string;
  sessionId: string;
  message: AssistantMessage;
  fallbackAgent: AgencyAgentIdentity;
  mode: AssistantMessagePersistenceMode;
}): Promise<void> {
  const { client, actorLogin, sessionId, message, mode } = input;
  if (mode === "settle-pending") {
    await client.command(sessionId, {
      kind: "update-message",
      actorLogin,
      entryId: message.id,
      content: message.text,
      view: message.view,
      status: "committed",
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  await client.command(sessionId, {
    kind: "append-message",
    actorLogin,
    entryId: message.id,
    idempotencyKey: message.id,
    role: "assistant",
    agent: message.agent ?? input.fallbackAgent,
    content: message.text,
    view: message.view,
    status: mode === "append-pending" ? "pending" : "committed",
    turnId: message.turnId ?? message.id,
    attachmentIds: message.attachments?.map((item) =>
      storedAttachmentId(item.id),
    ),
    createdAt: message.timestamp,
  });
}
