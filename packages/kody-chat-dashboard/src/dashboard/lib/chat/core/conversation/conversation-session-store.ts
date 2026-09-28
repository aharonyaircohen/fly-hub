import type {
  AgentHandoff,
  ChatMessage,
  SessionMeta,
} from "../../../chat-types";
import { isRenderedViewDirective } from "../../../chat-ui-actions";
import { machineAccessForRuntime } from "../machine-access";
import { parseReasoning } from "../reasoning";

type StoredMessage = {
  kind: "message";
  role: "user" | "assistant";
  content: string;
  view?: unknown;
  status: "pending" | "committed" | "failed" | "cancelled";
  turnId?: string;
  attachmentIds?: string[];
  createdAt: string;
};

type StoredHandoff = {
  kind: "agent-handoff";
  from: { slug: string; title: string };
  to: { slug: string; title: string };
  createdAt: string;
};

export type ConversationDetail = {
  conversation: {
    conversationId: string;
    scope?:
      { kind: "global" } | { kind: "repository"; owner: string; repo: string };
    title: string;
    preview?: string;
    pinned: boolean;
    activeAgent: { slug: string; title: string };
    runtime: { kind: string; [key: string]: unknown };
    machineAccess?: "none" | "local" | "brain";
    createdAt: string;
    updatedAt: string;
  };
  entries: Array<{
    entryId: string;
    seq: number;
    entry: StoredMessage | StoredHandoff;
  }>;
  turns?: Array<{
    turnId: string;
    status: "running" | "completed" | "failed" | "cancelled";
    agent: { slug: string; title: string };
    startedAt: string;
    assistantEntryId?: string;
    completedAt?: string;
    errorCode?: string;
    errorDetail?: string;
    progress?: {
      reasoning: string;
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        description?: string;
        activityKind?: "subagent";
        displayName?: string;
        status: "running" | "success" | "error";
      }>;
    };
  }>;
  checkpoints: Array<{
    version: number;
    throughSeq: number;
    agentEpochId: string;
    summary: string;
    sourceHash: string;
    createdAt: string;
  }>;
  attachments?: Array<{
    attachment: {
      attachmentId: string;
      fileName: string;
      mediaType: string;
      sizeBytes: number;
    };
  }>;
};

function agentKeyForRuntime(
  runtime: ConversationDetail["conversation"]["runtime"],
): string {
  switch (runtime.kind) {
    case "brain":
      return String(runtime.brainId);
    case "engine":
    case "live":
      return String(runtime.profileId);
    default:
      return String(runtime.modelId);
  }
}

export function mapConversationDetail(detail: ConversationDetail): {
  session: SessionMeta;
  messages: ChatMessage[];
  hasRunningTurns: boolean;
} {
  const ordered = [...detail.entries].sort((a, b) => a.seq - b.seq);
  const turnsById = new Map(
    (detail.turns ?? []).map((turn) => [turn.turnId, turn]),
  );
  const handoffs: AgentHandoff[] = ordered.flatMap((stored) =>
    stored.entry.kind === "agent-handoff"
      ? [
          {
            id: stored.entryId,
            fromSlug: stored.entry.from.slug,
            fromTitle: stored.entry.from.title,
            toSlug: stored.entry.to.slug,
            toTitle: stored.entry.to.title,
            switchedAt: stored.entry.createdAt,
          },
        ]
      : [],
  );
  const storedMessages: ChatMessage[] = ordered.flatMap((stored) => {
    if (stored.entry.kind !== "message") return [];
    const durableTurn = stored.entry.turnId
      ? turnsById.get(stored.entry.turnId)
      : undefined;
    const durableProgress =
      stored.entry.role === "assistant" ? durableTurn?.progress : undefined;
    const rawStoredContent =
      stored.entry.role === "assistant" &&
      (durableTurn?.status === "failed" || durableTurn?.status === "cancelled")
        ? durableTurn.errorDetail ||
          "Error: The reply could not be completed. Please retry."
        : stored.entry.content;
    const parsedStoredContent =
      stored.entry.role === "assistant"
        ? parseReasoning(rawStoredContent)
        : { reasoning: "", answer: rawStoredContent };
    const storedContent =
      stored.entry.role === "assistant"
        ? parsedStoredContent.answer.trim()
        : parsedStoredContent.answer;
    const reasoning = durableProgress?.reasoning || parsedStoredContent.reasoning;
    return [
      {
        id: stored.entryId,
        turnId: stored.entry.turnId,
        role: stored.entry.role,
        text: reasoning
          ? `<think>${reasoning}</think>\n\n${storedContent}`
          : storedContent,
        toolCalls: durableProgress?.toolCalls.map((toolCall) => ({
          name: toolCall.name,
          arguments: toolCall.arguments,
          description: toolCall.description,
          activityKind: toolCall.activityKind,
          displayName: toolCall.displayName,
          status: toolCall.status,
        })),
        view: isRenderedViewDirective(stored.entry.view)
          ? stored.entry.view
          : undefined,
        timestamp: stored.entry.createdAt,
        isLoading:
          stored.entry.status === "pending" &&
          (!durableTurn || durableTurn.status === "running"),
        attachments: stored.entry.attachmentIds?.flatMap((id) => {
          const metadata = detail.attachments?.find(
            (item) => item.attachment.attachmentId === id,
          )?.attachment;
          return metadata
            ? [
                {
                  id: `${detail.conversation.conversationId}::${id}`,
                  name: metadata.fileName,
                  mimeType: metadata.mediaType,
                  size: metadata.sizeBytes,
                },
              ]
            : [];
        }),
      },
    ];
  });
  const storedMessageIds = new Set(
    storedMessages.flatMap((message) => (message.id ? [message.id] : [])),
  );
  const storedTurnIds = new Set(
    storedMessages.flatMap((message) =>
      message.turnId ? [message.turnId] : [],
    ),
  );
  const recoveredTurns = (detail.turns ?? [])
    .filter(
      (turn) =>
        turn.status !== "completed" &&
        !storedMessageIds.has(`assistant:${turn.turnId}`) &&
        !storedTurnIds.has(turn.turnId),
    )
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const hasRunningTurns =
    storedMessages.some(
      (message) => message.role === "assistant" && message.isLoading,
    ) || recoveredTurns.some((turn) => turn.status === "running");
  const messages: ChatMessage[] = [
    ...storedMessages,
    ...recoveredTurns.map((turn) => ({
      id: `assistant:${turn.turnId}`,
      turnId: turn.turnId,
      role: "assistant" as const,
      text:
        turn.status === "running"
          ? turn.progress?.reasoning
            ? `<think>${turn.progress.reasoning}</think>\n\n`
            : ""
          : turn.errorDetail ||
            "Error: The reply could not be completed. Please retry.",
      timestamp: turn.completedAt ?? turn.startedAt,
      agent: turn.agent,
      isLoading: turn.status === "running",
      toolCalls: turn.progress?.toolCalls.map((toolCall) => ({
        name: toolCall.name,
        arguments: toolCall.arguments,
        description: toolCall.description,
        activityKind: toolCall.activityKind,
        displayName: toolCall.displayName,
        status: toolCall.status,
      })),
    })),
  ];
  const checkpoint = [...detail.checkpoints]
    .sort((a, b) => b.version - a.version)
    .at(0);
  return {
    session: {
      id: detail.conversation.conversationId,
      title: detail.conversation.title,
      preview: detail.conversation.preview,
      createdAt: detail.conversation.createdAt,
      updatedAt: detail.conversation.updatedAt,
      messageCount: messages.length,
      pinned: detail.conversation.pinned,
      repository:
        detail.conversation.scope?.kind === "repository"
          ? {
              owner: detail.conversation.scope.owner,
              repo: detail.conversation.scope.repo,
            }
          : undefined,
      agentKey: agentKeyForRuntime(detail.conversation.runtime),
      machineAccess: machineAccessForRuntime(
        detail.conversation.machineAccess,
        detail.conversation.runtime,
      ),
      agencyAgent: detail.conversation.activeAgent,
      agentHandoffs: handoffs,
      contextCheckpoint: checkpoint
        ? {
            revision: checkpoint.version,
            version: 1,
            throughMessageCount: checkpoint.throughSeq + 1,
            summary: checkpoint.summary,
            sourceFingerprint: checkpoint.sourceHash,
            createdAt: checkpoint.createdAt,
          }
        : undefined,
      status: hasRunningTurns ? "running" : "idle",
    },
    messages,
    hasRunningTurns,
  };
}

export type MessagePersistenceChange =
  | { kind: "append"; message: ChatMessage }
  | { kind: "update"; message: ChatMessage }
  | { kind: "remove"; message: ChatMessage };

export function reconcileConversationMessages(
  previous: readonly ChatMessage[],
  next: readonly ChatMessage[],
): MessagePersistenceChange[] {
  const previousById = new Map(
    previous.flatMap((message) => (message.id ? [[message.id, message]] : [])),
  );
  const nextIds = new Set(
    next.flatMap((message) => (message.id ? [message.id] : [])),
  );
  const changes: MessagePersistenceChange[] = [];
  for (const message of previous) {
    if (message.id && !nextIds.has(message.id)) {
      changes.push({ kind: "remove", message });
    }
  }
  for (const message of next) {
    if (!message.id) continue;
    const stored = previousById.get(message.id);
    if (message.role === "assistant" && message.isLoading) {
      continue;
    }
    if (!stored) {
      changes.push({ kind: "append", message });
      continue;
    }
    if (
      message.role === "assistant" &&
      stored.isLoading &&
      !message.isLoading
    ) {
      changes.push({ kind: "append", message });
      continue;
    }
    if (
      stored.text !== message.text ||
      stored.isLoading !== message.isLoading ||
      stored.view !== message.view
    ) {
      changes.push({ kind: "update", message });
    }
  }
  return changes;
}

export function ensureMessageIds(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map((message) =>
    message.id ? message : { ...message, id: crypto.randomUUID() },
  );
}
