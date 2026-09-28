export type ChatRole = "user" | "assistant" | "system";

export interface ChatAttachment {
  id: string;
  name: string;
  mediaType?: string;
  size?: number;
  url?: string;
}

export type ChatContext = Readonly<Record<string, unknown>>;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: readonly ChatAttachment[];
  status?: "streaming" | "complete" | "cancelled" | "error";
}

export interface ChatConversation {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  pinned?: boolean;
}

export type ChatErrorKind =
  "authentication" | "transport" | "storage" | "attachment" | "plugin";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
  retryable: boolean;
  cause?: unknown;
}

export interface ChatTurnInput {
  conversationId: string;
  message: ChatMessage & { role: "user" };
  history: readonly ChatMessage[];
  context?: ChatContext;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "text-replace"; text: string }
  | { type: "error"; message: string }
  | { type: "navigate"; href: string }
  | { type: "done" }
  | { type: string; [key: string]: unknown };

export interface ChatTransportContext {
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
}

export interface ChatTransport {
  send(input: ChatTurnInput, context: ChatTransportContext): Promise<void>;
  cancel?(conversationId: string): void;
}

export interface ChatPlugin {
  id: string;
  onEvent?: (event: ChatEvent, context: { conversationId: string }) => void;
}

export interface ChatConversationAdapter {
  list(): Promise<readonly ChatConversation[]>;
  create(input?: { title?: string }): Promise<ChatConversation>;
  rename?(conversationId: string, title: string): Promise<void>;
  remove?(conversationId: string): Promise<void>;
  setPinned?(conversationId: string, pinned: boolean): Promise<void>;
  load(conversationId: string): Promise<readonly ChatMessage[]>;
  save(conversationId: string, messages: readonly ChatMessage[]): Promise<void>;
}

export interface KodyChatHost {
  transport: ChatTransport;
  conversationId?: string;
  conversations?: ChatConversationAdapter;
  loadConversation?: (
    conversationId: string,
  ) => Promise<readonly ChatMessage[]>;
  saveConversation?: (
    conversationId: string,
    messages: readonly ChatMessage[],
  ) => Promise<void>;
  getContext?: () => ChatContext | Promise<ChatContext>;
  uploadAttachment?: (
    file: File,
    context: { signal: AbortSignal; conversationId: string },
  ) => Promise<ChatAttachment>;
  plugins?: readonly ChatPlugin[];
  navigate?: (href: string) => void;
  onError?: (error: ChatError) => void;
}

const CHAT_ERROR_KINDS = new Set<ChatErrorKind>([
  "authentication",
  "transport",
  "storage",
  "attachment",
  "plugin",
]);

export function normalizeChatError(
  value: unknown,
  fallbackKind: ChatErrorKind,
): ChatError {
  if (value && typeof value === "object") {
    const candidate = value as Partial<ChatError>;
    const kind = CHAT_ERROR_KINDS.has(candidate.kind as ChatErrorKind)
      ? (candidate.kind as ChatErrorKind)
      : fallbackKind;
    const message =
      typeof candidate.message === "string" && candidate.message.trim()
        ? candidate.message
        : "Chat request failed";
    return {
      kind,
      message,
      retryable: candidate.retryable === true,
      cause: candidate.cause ?? value,
    };
  }

  return {
    kind: fallbackKind,
    message: "Chat request failed",
    retryable: false,
    cause: value,
  };
}

export function applyChatEvent(
  messages: readonly ChatMessage[],
  assistantMessageId: string,
  event: ChatEvent,
): ChatMessage[] {
  if (event.type === "navigate" || event.type === "done") return [...messages];

  return messages.map((message) => {
    if (message.id !== assistantMessageId) return message;
    if (event.type === "text-delta" && typeof event.text === "string") {
      return { ...message, content: message.content + event.text };
    }
    if (event.type === "text-replace" && typeof event.text === "string") {
      return { ...message, content: event.text };
    }
    if (event.type === "error" && typeof event.message === "string") {
      return { ...message, content: event.message, status: "error" };
    }
    return message;
  });
}
