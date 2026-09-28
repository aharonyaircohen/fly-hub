export type AgentIdentity = Readonly<{
  slug: string;
  title: string;
}>;

export type MessageStatus = "pending" | "committed" | "failed" | "cancelled";

export type ConversationScope =
  | Readonly<{
      kind: "global";
    }>
  | Readonly<{
      kind: "repository";
      owner: string;
      repo: string;
    }>;

export type ConversationRuntime =
  | Readonly<{
      kind: "direct";
      modelId: string;
    }>
  | Readonly<{
      kind: "brain";
      brainId: string;
    }>
  | Readonly<{
      kind: "engine";
      profileId: string;
    }>
  | Readonly<{
      kind: "live";
      profileId: string;
    }>;

type ConversationAuthor =
  | Readonly<{
      kind: "user";
      actorId: string;
    }>
  | (Readonly<{
      kind: "agent";
    }> &
      AgentIdentity);

export type ConversationMessageEntry = Readonly<{
  kind: "message";
  id: string;
  seq: number;
  role: "user" | "assistant";
  author: ConversationAuthor;
  content: string;
  status: MessageStatus;
  createdAt: string;
}>;

export type AgentHandoffEntry = Readonly<{
  kind: "agent-handoff";
  id: string;
  seq: number;
  from: AgentIdentity;
  to: AgentIdentity;
  createdAt: string;
}>;

export type ConversationEntry = ConversationMessageEntry | AgentHandoffEntry;

export type Conversation = Readonly<{
  id: string;
  scope: ConversationScope;
  title: string;
  activeAgent: AgentIdentity;
  runtime: ConversationRuntime;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationCheckpoint = Readonly<{
  version: number;
  throughSeq: number;
  agentEpochId: string;
  summary: string;
  sourceHash: string;
  createdAt: string;
}>;

export type PreparedConversationTurn = Readonly<{
  conversationId: string;
  scope: ConversationScope;
  speaker: AgentIdentity;
  runtime: ConversationRuntime;
  agentEpochId: string;
  currentMessage: ConversationMessageEntry;
  activeHistory: readonly ConversationMessageEntry[];
  previousAgentContext: readonly ConversationMessageEntry[];
  summary: string | null;
}>;

const INITIAL_AGENT_EPOCH_ID = "initial";

function orderedEntries(
  entries: readonly ConversationEntry[],
): readonly ConversationEntry[] {
  const ordered = [...entries].sort((left, right) => left.seq - right.seq);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]?.seq === ordered[index]?.seq) {
      throw new Error(
        `Duplicate conversation sequence: ${ordered[index]?.seq}`,
      );
    }
  }
  return ordered;
}

function isCommittedMessage(
  entry: ConversationEntry,
): entry is ConversationMessageEntry {
  return entry.kind === "message" && entry.status === "committed";
}

export function prepareConversationTurn(input: {
  conversation: Conversation;
  entries: readonly ConversationEntry[];
  currentMessageId: string;
  checkpoint?: ConversationCheckpoint;
}): PreparedConversationTurn {
  const entries = orderedEntries(input.entries);
  const currentEntry = entries.find(
    (entry) => entry.id === input.currentMessageId,
  );

  if (
    !currentEntry ||
    currentEntry.kind !== "message" ||
    currentEntry.role !== "user" ||
    currentEntry.status !== "committed"
  ) {
    throw new Error(
      "Current conversation message must be a committed user message",
    );
  }

  if (
    entries.some(
      (entry) => entry.kind === "message" && entry.seq > currentEntry.seq,
    )
  ) {
    throw new Error("Current conversation message is not the latest message");
  }

  const latestHandoff = entries
    .filter(
      (entry): entry is AgentHandoffEntry =>
        entry.kind === "agent-handoff" && entry.seq < currentEntry.seq,
    )
    .at(-1);
  const agentEpochId = latestHandoff?.id ?? INITIAL_AGENT_EPOCH_ID;
  const epochStartSeq = latestHandoff?.seq ?? -1;
  const checkpoint =
    input.checkpoint?.agentEpochId === agentEpochId &&
    input.checkpoint.throughSeq > epochStartSeq &&
    input.checkpoint.throughSeq < currentEntry.seq
      ? input.checkpoint
      : undefined;

  const committedHistory = entries.filter(
    (entry): entry is ConversationMessageEntry =>
      isCommittedMessage(entry) && entry.seq < currentEntry.seq,
  );

  return {
    conversationId: input.conversation.id,
    scope: input.conversation.scope,
    speaker: input.conversation.activeAgent,
    runtime: input.conversation.runtime,
    agentEpochId,
    currentMessage: currentEntry,
    activeHistory: committedHistory.filter(
      (entry) =>
        entry.seq > (checkpoint?.throughSeq ?? epochStartSeq) &&
        entry.seq > epochStartSeq,
    ),
    previousAgentContext: committedHistory.filter(
      (entry) => entry.seq < epochStartSeq,
    ),
    summary: checkpoint?.summary ?? null,
  };
}
