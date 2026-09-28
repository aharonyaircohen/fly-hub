"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyChatEvent,
  normalizeChatError,
  type ChatEvent,
  type ChatAttachment,
  type ChatConversation,
  type ChatError,
  type ChatMessage,
  type KodyChatHost,
} from "./core";
import { KodyChatFrame } from "./frame";

export { KodyChatFrame, type KodyChatFrameProps } from "./frame";

export interface KodyChatProps {
  host: KodyChatHost;
  initialMessages?: readonly ChatMessage[];
  title?: string;
  placeholder?: string;
  className?: string;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function KodyChat({
  host,
  initialMessages = [],
  title = "Chat",
  placeholder = "Write a message",
  className,
}: KodyChatProps) {
  const initialConversationId = useMemo(
    () => host.conversationId ?? createId(),
    [host.conversationId],
  );
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationTitle, setConversationTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([...initialMessages]);
  const [isHydrated, setIsHydrated] = useState(!host.loadConversation);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [visibleError, setVisibleError] = useState<ChatError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reportError = useCallback(
    (error: unknown, kind: ChatError["kind"]) => {
      const failure = normalizeChatError(error, kind);
      setVisibleError(failure);
      host.onError?.(failure);
      return failure;
    },
    [host],
  );

  useEffect(() => {
    if (!host.conversations) return;
    let cancelled = false;
    void host.conversations
      .list()
      .then((loaded) => {
        if (cancelled) return;
        setConversations([...loaded]);
        const active =
          loaded.find((conversation) => conversation.id === conversationId) ??
          loaded[0];
        if (active) {
          setIsHydrated(false);
          setConversationId(active.id);
          setConversationTitle(active.title ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) reportError(error, "storage");
      });
    return () => {
      cancelled = true;
    };
  }, [host.conversations, reportError]);

  useEffect(() => {
    const loadConversation = host.conversations?.load ?? host.loadConversation;
    if (!loadConversation) {
      setIsHydrated(true);
      return;
    }
    let cancelled = false;
    setIsHydrated(false);
    void loadConversation(conversationId)
      .then((loaded) => {
        if (!cancelled) {
          setMessages([...loaded]);
          setIsHydrated(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIsHydrated(true);
          reportError(error, "storage");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, host.conversations, host.loadConversation, reportError]);

  const saveMessages = useCallback(async () => {
    const saveConversation = host.conversations?.save ?? host.saveConversation;
    if (!saveConversation) return;
    try {
      await saveConversation(conversationId, messages);
      setVisibleError((current) =>
        current?.kind === "storage" ? null : current,
      );
    } catch (error: unknown) {
      reportError(error, "storage");
    }
  }, [
    conversationId,
    host.conversations,
    host.saveConversation,
    messages,
    reportError,
  ]);

  useEffect(() => {
    if (!isHydrated) return;
    void saveMessages();
  }, [isHydrated, saveMessages]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    host.transport.cancel?.(conversationId);
    setMessages((current) =>
      current.map((message) =>
        message.status === "streaming"
          ? { ...message, status: "cancelled" }
          : message,
      ),
    );
    setIsSending(false);
  }, [conversationId, host.transport]);

  useEffect(() => cancel, [cancel]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    const userMessage: ChatMessage & { role: "user" } = {
      id: createId(),
      role: "user",
      content: text,
      ...(attachments.length > 0 ? { attachments } : {}),
      status: "complete",
    };
    const assistantMessage: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      status: "streaming",
    };
    const history = [...messages];
    setMessages([...history, userMessage, assistantMessage]);
    setDraft("");
    setAttachments([]);
    setIsSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const emit = (event: ChatEvent) => {
      for (const plugin of host.plugins ?? []) {
        plugin.onEvent?.(event, { conversationId });
      }
      if (event.type === "navigate" && typeof event.href === "string") {
        host.navigate?.(event.href);
        return;
      }
      setMessages((current) =>
        applyChatEvent(current, assistantMessage.id, event),
      );
    };

    try {
      const context = await host.getContext?.();
      await host.transport.send(
        { conversationId, message: userMessage, history, context },
        { signal: controller.signal, emit },
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id && message.status === "streaming"
            ? { ...message, status: "complete" }
            : message,
        ),
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        const failure = normalizeChatError(error, "transport");
        emit({ type: "error", message: failure.message });
        host.onError?.(failure);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsSending(false);
    }
  }, [attachments, conversationId, draft, host, isSending, messages]);

  const attach = useCallback(
    async (file: File) => {
      if (!host.uploadAttachment) return;
      const controller = new AbortController();
      setIsUploading(true);
      try {
        const uploaded = await host.uploadAttachment(file, {
          signal: controller.signal,
          conversationId,
        });
        setAttachments((current) => [...current, uploaded]);
      } catch (error: unknown) {
        reportError(error, "attachment");
      } finally {
        setIsUploading(false);
      }
    },
    [conversationId, host, reportError],
  );

  const createConversation = useCallback(async () => {
    if (!host.conversations) return;
    try {
      const created = await host.conversations.create({
        title: "New conversation",
      });
      setConversations((current) => [...current, created]);
      setConversationId(created.id);
      setConversationTitle(created.title ?? "");
      setMessages([]);
      setVisibleError(null);
    } catch (error: unknown) {
      reportError(error, "storage");
    }
  }, [host.conversations, reportError]);

  const renameConversation = useCallback(async () => {
    const title = conversationTitle.trim();
    if (!title || !host.conversations?.rename) return;
    try {
      await host.conversations.rename(conversationId, title);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, title }
            : conversation,
        ),
      );
      setVisibleError(null);
    } catch (error: unknown) {
      reportError(error, "storage");
    }
  }, [conversationId, conversationTitle, host.conversations, reportError]);

  const removeConversation = useCallback(async () => {
    if (!host.conversations?.remove) return;
    try {
      await host.conversations.remove(conversationId);
      const remaining = conversations.filter(
        (conversation) => conversation.id !== conversationId,
      );
      setConversations(remaining);
      const next = remaining[0];
      if (next) {
        setConversationId(next.id);
        setConversationTitle(next.title ?? "");
      } else {
        setMessages([]);
        setConversationTitle("");
      }
      setVisibleError(null);
    } catch (error: unknown) {
      reportError(error, "storage");
    }
  }, [conversationId, conversations, host.conversations, reportError]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const header = <header className="kody-chat__header">{title}</header>;
  const sessionsPanel = host.conversations ? (
    <aside className="kody-chat__sessions" aria-label="Conversations">
      <label htmlFor={`${initialConversationId}-conversation`}>
        Conversation
      </label>
      <select
        aria-label="Conversation"
        id={`${initialConversationId}-conversation`}
        onChange={(event) => {
          const nextId = event.target.value;
          const next = conversations.find(
            (conversation) => conversation.id === nextId,
          );
          setIsHydrated(false);
          setConversationId(nextId);
          setConversationTitle(next?.title ?? "");
        }}
        value={conversationId}
      >
        {conversations.map((conversation) => (
          <option key={conversation.id} value={conversation.id}>
            {conversation.title || "Untitled conversation"}
          </option>
        ))}
      </select>
      <button onClick={() => void createConversation()} type="button">
        New conversation
      </button>
      {host.conversations.rename ? (
        <>
          <input
            aria-label="Conversation title"
            onChange={(event) => setConversationTitle(event.target.value)}
            value={conversationTitle}
          />
          <button onClick={() => void renameConversation()} type="button">
            Save title
          </button>
        </>
      ) : null}
      {host.conversations.remove ? (
        <button onClick={() => void removeConversation()} type="button">
          Delete conversation
        </button>
      ) : null}
    </aside>
  ) : undefined;
  const messageList = (
    <div className="kody-chat__messages" aria-live="polite">
      {messages.map((message) => (
        <article
          className={`kody-chat__message kody-chat__message--${message.role}`}
          data-status={message.status}
          key={message.id}
        >
          {message.content || (message.status === "streaming" ? "…" : "")}
        </article>
      ))}
    </div>
  );
  const composer = (
    <form className="kody-chat__composer" onSubmit={submit}>
      <label className="kody-chat__label" htmlFor={`${conversationId}-input`}>
        Message
      </label>
      <textarea
        id={`${conversationId}-input`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onComposerKeyDown}
        placeholder={placeholder}
        rows={2}
        value={draft}
      />
      {host.uploadAttachment ? (
        <label className="kody-chat__attach">
          <span>Attach file</span>
          <input
            aria-label="Attach file"
            disabled={isSending || isUploading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void attach(file);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
      ) : null}
      {attachments.length > 0 ? (
        <div className="kody-chat__attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id}>{attachment.name}</span>
          ))}
        </div>
      ) : null}
      {isSending ? (
        <button onClick={cancel} type="button">
          Stop
        </button>
      ) : (
        <button disabled={!draft.trim() || isUploading} type="submit">
          Send
        </button>
      )}
    </form>
  );

  return (
    <KodyChatFrame
      rootClassName={["kody-chat", className].filter(Boolean).join(" ")}
      contentClassName="kody-chat__content"
      header={header}
      sessionsPanel={sessionsPanel}
      notice={
        visibleError ? (
          <div className="kody-chat__notice" role="alert">
            <span>{visibleError.message}</span>
            {visibleError.kind === "storage" && visibleError.retryable ? (
              <button onClick={() => void saveMessages()} type="button">
                Retry save
              </button>
            ) : null}
          </div>
        ) : undefined
      }
      messages={messageList}
      composer={composer}
    />
  );
}
