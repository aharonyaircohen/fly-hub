import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgencyAgentIdentity,
  ChatMessage,
  MachineAccess,
  SessionMeta,
} from "../../../chat-types";
import type { ConversationCheckpoint } from "../conversation-compaction";
import {
  createConversationClient,
  type ConversationCommand,
} from "./conversation-client";
import {
  ensureMessageIds,
  mapConversationDetail,
  reconcileConversationMessages,
  type ConversationDetail,
} from "./conversation-session-store";
import {
  persistAssistantConversationMessage,
  type AssistantMessagePersistenceMode,
} from "./assistant-message-persistence";
import { useRunningTurnRecovery } from "./use-running-turn-recovery";
import {
  runtimeForAgentKey,
  sessionFromList,
  storedAttachmentId,
} from "./conversation-session-mapping";

export type ChatSessionScope = "global" | "vibe-default";
type MessageUpdater =
  ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[]);

const persistenceErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Conversation save failed";

function activeSessionStorageKey(scope: ChatSessionScope): string {
  return `kody-chat:active-session:${scope}`;
}

function readTabActiveSessionId(scope: ChatSessionScope): string | null {
  try {
    return window.sessionStorage.getItem(activeSessionStorageKey(scope));
  } catch {
    return null;
  }
}

function writeTabActiveSessionId(
  scope: ChatSessionScope,
  sessionId: string,
): void {
  try {
    if (sessionId) {
      window.sessionStorage.setItem(activeSessionStorageKey(scope), sessionId);
    } else {
      window.sessionStorage.removeItem(activeSessionStorageKey(scope));
    }
  } catch {}
}

export interface UseConversationSessionsResult {
  hydrated: boolean;
  sessions: SessionMeta[];
  activeSession: SessionMeta | null;
  messages: ChatMessage[];
  persistenceError: string | null;
  persistUserMessage: (
    sessionId: string,
    message: ChatMessage & { id: string; role: "user" },
  ) => Promise<void>;
  persistAssistantMessage: (
    sessionId: string,
    message: ChatMessage & { id: string; role: "assistant" },
  ) => Promise<void>;
  persistPendingAssistantMessage: (
    sessionId: string,
    message: ChatMessage & { id: string; role: "assistant" },
  ) => Promise<void>;
  settlePendingAssistantMessage: (
    sessionId: string,
    message: ChatMessage & { id: string; role: "assistant" },
  ) => Promise<void>;
  /** Refresh a durable turn now, then keep polling while it is running. */
  recoverRunningTurn: (sessionId: string) => void;
  setMessages: (messages: MessageUpdater) => void;
  setSessionMessages: (
    sessionId: string,
    messages: MessageUpdater,
    options?: { persist?: boolean },
  ) => void;
  getSessionMessages: (sessionId: string) => ChatMessage[];
  resolveSessionId: (sessionId: string) => Promise<string>;
  resolveRuntimeSessionId: (sessionId: string) => Promise<string | undefined>;
  createSession: (opts?: {
    agentKey?: string;
    machineAccess?: MachineAccess;
  }) => string;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  pinSession: (sessionId: string) => void;
  clearActiveSession: () => void;
  setSessionAgent: (sessionId: string, agentKey: string) => void;
  setSessionMachineAccess: (
    sessionId: string,
    machineAccess: MachineAccess,
  ) => void;
  setSessionAgencyAgent: (
    sessionId: string,
    agent: AgencyAgentIdentity,
  ) => void;
  setSessionCheckpoint: (
    sessionId: string,
    checkpoint: ConversationCheckpoint,
  ) => void;
}

export function mergeHydratedSessions(
  loaded: SessionMeta[],
  locallyCreated: SessionMeta[],
): SessionMeta[] {
  const loadedById = new Map(loaded.map((session) => [session.id, session]));
  const localById = new Map(
    locallyCreated.map((session) => [session.id, session]),
  );
  return [
    ...locallyCreated.filter((session) => !loadedById.has(session.id)),
    ...loaded.map((remote) => {
      const local = localById.get(remote.id);
      if (!local) return remote;
      return Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)
        ? local
        : remote;
    }),
  ];
}

export function shouldLoadHydratedSessionDetail(
  sessionId: string,
  locallyCreatedSessionIds: ReadonlySet<string>,
): boolean {
  return !locallyCreatedSessionIds.has(sessionId);
}

export function preserveActiveSessionId(
  currentSessionId: string,
  firstLoadedSessionId: string,
): string {
  return currentSessionId || firstLoadedSessionId;
}

export function preferredHydratedSessionId(
  loaded: SessionMeta[],
  preferredSessionId?: string | null,
): string {
  if (
    preferredSessionId &&
    loaded.some((session) => session.id === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  return loaded[0]?.id ?? "";
}

/** Keep the active draft visible without filling the picker with empty drafts. */
export function shouldShowConversationSession(
  session: Pick<SessionMeta, "id" | "messageCount">,
  activeSessionId: string,
): boolean {
  return session.id === activeSessionId || session.messageCount > 0;
}

export function useConversationSessions(
  scope: ChatSessionScope = "global",
  requestHeaders?: Record<string, string>,
  actorLogin: string | null = null,
  persistenceEnabled = true,
  preferredSessionId?: string | null,
): UseConversationSessionsResult {
  const conversationClient = useMemo(
    () => createConversationClient(requestHeaders ?? {}),
    [requestHeaders],
  );
  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const sessionsRef = useRef<SessionMeta[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, ChatMessage[]>
  >({});
  const [activeSessionId, setActiveSessionId] = useState("");
  const [recoveringSessionIds, setRecoveringSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const persistenceGenerationRef = useRef(0);
  const locallyCreatedSessionIdsRef = useRef(new Set<string>());
  const hydratedScopeRef = useRef(scope);
  const preferredSessionIdRef = useRef(preferredSessionId);
  preferredSessionIdRef.current = preferredSessionId;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const persist = useCallback((operation: Promise<unknown>) => {
    const generation = ++persistenceGenerationRef.current;
    void operation
      .then(() => {
        if (persistenceGenerationRef.current === generation)
          setPersistenceError(null);
      })
      .catch((error: unknown) => {
        if (persistenceGenerationRef.current !== generation) return;
        setPersistenceError(persistenceErrorMessage(error));
      });
  }, []);

  const loadDetail = useCallback(
    async (conversationId: string) => {
      const detail = (await conversationClient.get(
        conversationId,
      )) as ConversationDetail;
      const mapped = mapConversationDetail(detail);
      setSessions((previous) => [
        ...previous.filter((session) => session.id !== conversationId),
        mapped.session,
      ]);
      setMessagesBySession((previous) => ({
        ...previous,
        [conversationId]: mapped.messages,
      }));
      setRecoveringSessionIds((previous) => {
        const alreadyRecovering = previous.has(conversationId);
        if (alreadyRecovering === mapped.hasRunningTurns) return previous;
        const next = new Set(previous);
        if (mapped.hasRunningTurns) next.add(conversationId);
        else next.delete(conversationId);
        return next;
      });
      return mapped.hasRunningTurns;
    },
    [conversationClient],
  );

  useEffect(() => {
    let cancelled = false;
    const scopeChanged = hydratedScopeRef.current !== scope;
    hydratedScopeRef.current = scope;
    // Repository/page navigation can replace the request headers while the
    // global conversation and its stream are still active. Rehydrating the
    // client must not clear that in-memory session: doing so makes minimizing
    // /chat hide the reply that is still arriving. A real conversation-scope
    // change (global <-> Vibe) still starts from a clean selection.
    if (scopeChanged) {
      locallyCreatedSessionIdsRef.current = new Set();
      setActiveSessionId("");
      setRecoveringSessionIds(new Set());
    }
    if (!persistenceEnabled) {
      setSessions([]);
      setMessagesBySession({});
      setPersistenceError(null);
      setHydrated(true);
      return () => {
        cancelled = true;
      };
    }
    if (scopeChanged) setHydrated(false);
    void conversationClient
      .list(scope)
      .then(async (records) => {
        if (cancelled) return;
        const loaded = records.map(sessionFromList);
        setSessions((previous) => {
          const locallyCreated = previous.filter((session) =>
            locallyCreatedSessionIdsRef.current.has(session.id),
          );
          const merged = mergeHydratedSessions(loaded, locallyCreated);
          sessionsRef.current = merged;
          return merged;
        });
        const firstId = preferredHydratedSessionId(
          loaded,
          preferredSessionIdRef.current ?? readTabActiveSessionId(scope),
        );
        setActiveSessionId((current) =>
          preserveActiveSessionId(current, firstId),
        );
        if (
          firstId &&
          shouldLoadHydratedSessionDetail(
            firstId,
            locallyCreatedSessionIdsRef.current,
          )
        ) {
          await loadDetail(firstId);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPersistenceError(
            error instanceof Error ? error.message : "Conversation load failed",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationClient, loadDetail, persistenceEnabled, scope]);

  const handleRunningTurnRefreshError = useCallback((error: unknown) => {
    setPersistenceError(
      error instanceof Error ? error.message : "Conversation refresh failed",
    );
  }, []);
  const recoverRunningTurn = useRunningTurnRecovery({
    activeSessionId,
    hydrated,
    persistenceEnabled,
    recoveringSessionIds,
    setRecoveringSessionIds,
    loadDetail,
    onError: handleRunningTurnRefreshError,
  });

  useEffect(() => {
    if (!hydrated || !persistenceEnabled) return;
    writeTabActiveSessionId(scope, activeSessionId);
  }, [activeSessionId, hydrated, persistenceEnabled, scope]);

  const orderedSessions = useMemo(
    () =>
      sessions
        .filter((session) =>
          shouldShowConversationSession(session, activeSessionId),
        )
        .sort((left, right) => {
          if (Boolean(left.pinned) !== Boolean(right.pinned)) {
            return left.pinned ? -1 : 1;
          }
          return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        }),
    [activeSessionId, sessions],
  );
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? null;
  const messages = activeSessionId
    ? (messagesBySession[activeSessionId] ?? [])
    : [];

  const createSession = useCallback(
    (opts?: { agentKey?: string; machineAccess?: MachineAccess }) => {
      const id = crypto.randomUUID();
      locallyCreatedSessionIdsRef.current.add(id);
      const now = new Date().toISOString();
      const login = actorLogin;
      const repository =
        requestHeaders?.["x-kody-owner"] && requestHeaders["x-kody-repo"]
          ? {
              owner: requestHeaders["x-kody-owner"],
              repo: requestHeaders["x-kody-repo"],
            }
          : undefined;
      const session: SessionMeta = {
        id,
        title: "New conversation",
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        pinned: false,
        repository,
        agentKey: opts?.agentKey,
        agencyAgent: { slug: "kody", title: "Kody" },
        machineAccess: opts?.machineAccess ?? "none",
      };
      const nextSessions = [session, ...sessionsRef.current];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setMessagesBySession((previous) => ({ ...previous, [id]: [] }));
      setActiveSessionId(id);
      if (login) {
        persist(
          conversationClient.create({
            conversationId: id,
            title: session.title,
            activeAgent: session.agencyAgent,
            runtime: runtimeForAgentKey(opts?.agentKey),
            machineAccess: session.machineAccess,
            actorLogin: login,
            surface: scope,
          }),
        );
      }
      return id;
    },
    [actorLogin, conversationClient, persist, requestHeaders, scope],
  );

  const persistMessageChanges = useCallback(
    (session: SessionMeta, previous: ChatMessage[], next: ChatMessage[]) => {
      const login = actorLogin;
      if (!login) return;
      for (const change of reconcileConversationMessages(previous, next)) {
        const message = change.message;
        if (change.kind === "remove") {
          persist(
            conversationClient.command(session.id, {
              kind: "remove-message",
              actorLogin: login,
              entryId: message.id!,
            }),
          );
          continue;
        }
        const status = message.isLoading ? "pending" : "committed";
        const command: ConversationCommand =
          change.kind === "append"
            ? {
                kind: "append-message",
                actorLogin: login,
                entryId: message.id!,
                idempotencyKey: message.id!,
                role: message.role,
                ...(message.role === "assistant"
                  ? {
                      agent: message.agent ??
                        session.agencyAgent ?? { slug: "kody", title: "Kody" },
                    }
                  : {}),
                content: message.text,
                view: message.view,
                status,
                turnId: message.turnId ?? message.id!,
                attachmentIds: message.attachments?.map((item) =>
                  storedAttachmentId(item.id),
                ),
                createdAt: message.timestamp,
              }
            : {
                kind: "update-message",
                actorLogin: login,
                entryId: message.id!,
                content: message.text,
                view: message.view,
                status,
                updatedAt: new Date().toISOString(),
              };
        persist(conversationClient.command(session.id, command));
      }
    },
    [actorLogin, conversationClient, persist],
  );

  const persistUserMessage = useCallback(
    async (
      sessionId: string,
      message: ChatMessage & { id: string; role: "user" },
    ) => {
      const login = actorLogin;
      if (!login)
        throw new Error("Conversation save requires a signed-in user");
      const generation = ++persistenceGenerationRef.current;
      try {
        await conversationClient.command(sessionId, {
          kind: "append-message",
          actorLogin: login,
          entryId: message.id,
          idempotencyKey: message.id,
          role: "user",
          content: message.text,
          status: "committed",
          turnId: message.id,
          attachmentIds: message.attachments?.map((item) =>
            storedAttachmentId(item.id),
          ),
          createdAt: message.timestamp,
        });
        if (persistenceGenerationRef.current === generation)
          setPersistenceError(null);
      } catch (error) {
        if (persistenceGenerationRef.current !== generation) throw error;
        setPersistenceError(persistenceErrorMessage(error));
        throw error;
      }
    },
    [actorLogin, conversationClient],
  );

  const saveAssistantMessage = useCallback(
    async (
      mode: AssistantMessagePersistenceMode,
      sessionId: string,
      message: ChatMessage & { id: string; role: "assistant" },
    ) => {
      const login = actorLogin;
      if (!login)
        throw new Error("Conversation save requires a signed-in user");
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      const generation = ++persistenceGenerationRef.current;
      try {
        await persistAssistantConversationMessage({
          client: conversationClient,
          actorLogin: login,
          sessionId,
          message,
          fallbackAgent: session?.agencyAgent ?? {
            slug: "kody",
            title: "Kody",
          },
          mode,
        });
        if (persistenceGenerationRef.current === generation)
          setPersistenceError(null);
      } catch (error) {
        if (persistenceGenerationRef.current !== generation) throw error;
        setPersistenceError(persistenceErrorMessage(error));
        throw error;
      }
    },
    [actorLogin, conversationClient],
  );

  const persistAssistantMessage = useCallback(
    (
      sessionId: string,
      message: ChatMessage & { id: string; role: "assistant" },
    ) => saveAssistantMessage("append-committed", sessionId, message),
    [saveAssistantMessage],
  );
  const persistPendingAssistantMessage = useCallback(
    (
      sessionId: string,
      message: ChatMessage & { id: string; role: "assistant" },
    ) => saveAssistantMessage("append-pending", sessionId, message),
    [saveAssistantMessage],
  );
  const settlePendingAssistantMessage = useCallback(
    (
      sessionId: string,
      message: ChatMessage & { id: string; role: "assistant" },
    ) => saveAssistantMessage("settle-pending", sessionId, message),
    [saveAssistantMessage],
  );
  const setSessionMessages = useCallback(
    (
      sessionId: string,
      value: MessageUpdater,
      options?: { persist?: boolean },
    ) => {
      setMessagesBySession((previousBySession) => {
        const previous = previousBySession[sessionId] ?? [];
        const next = ensureMessageIds(
          typeof value === "function" ? value(previous) : value,
        );
        const session = sessionsRef.current.find(
          (item) => item.id === sessionId,
        );
        if (session && options?.persist !== false) {
          persistMessageChanges(session, previous, next);
        }
        setSessions((current) =>
          current.map((item) =>
            item.id === sessionId
              ? {
                  ...item,
                  messageCount: next.length,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        return { ...previousBySession, [sessionId]: next };
      });
    },
    [persistMessageChanges],
  );

  const setMessages = useCallback(
    (value: MessageUpdater) => {
      if (activeSessionId) setSessionMessages(activeSessionId, value);
    },
    [activeSessionId, setSessionMessages],
  );

  const switchSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      if (!messagesBySession[sessionId]) persist(loadDetail(sessionId));
    },
    [loadDetail, messagesBySession, persist],
  );

  const renameSession = useCallback(
    (sessionId: string, title: string) => {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId ? { ...session, title } : session,
        ),
      );
      persist(conversationClient.updateMetadata(sessionId, { title }));
    },
    [conversationClient, persist],
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((previous) => {
        const remaining = previous.filter(
          (session) => session.id !== sessionId,
        );
        if (activeSessionId === sessionId) {
          setActiveSessionId(remaining[0]?.id ?? "");
        }
        return remaining;
      });
      setMessagesBySession((previous) => {
        const { [sessionId]: _removed, ...remaining } = previous;
        return remaining;
      });
      persist(conversationClient.remove(sessionId));
    },
    [activeSessionId, conversationClient, persist],
  );

  const pinSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (!session) return;
      const pinned = !session.pinned;
      setSessions((previous) =>
        previous.map((item) =>
          item.id === sessionId ? { ...item, pinned } : item,
        ),
      );
      persist(conversationClient.updateMetadata(sessionId, { pinned }));
    },
    [conversationClient, persist],
  );

  const clearActiveSession = useCallback(() => {
    if (!activeSessionId) return;
    setMessagesBySession((previous) => ({
      ...previous,
      [activeSessionId]: [],
    }));
    const login = actorLogin;
    if (login) {
      persist(
        conversationClient.command(activeSessionId, {
          kind: "clear",
          actorLogin: login,
        }),
      );
    }
  }, [activeSessionId, actorLogin, conversationClient, persist]);

  const setSessionAgent = useCallback(
    (sessionId: string, agentKey: string) => {
      setSessions((previous) => {
        const selectedAt = new Date().toISOString();
        const next = previous.map((session) =>
          session.id === sessionId
            ? { ...session, agentKey, updatedAt: selectedAt }
            : session,
        );
        sessionsRef.current = next;
        return next;
      });
      const login = actorLogin;
      if (login) {
        persist(
          conversationClient.command(sessionId, {
            kind: "runtime",
            actorLogin: login,
            runtime: runtimeForAgentKey(agentKey),
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    },
    [actorLogin, conversationClient, persist],
  );

  const setSessionAgencyAgent = useCallback(
    (sessionId: string, agent: AgencyAgentIdentity) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (!session || session.agencyAgent?.slug === agent.slug) return;
      const from = session.agencyAgent ?? { slug: "kody", title: "Kody" };
      const handoffId = crypto.randomUUID();
      const switchedAt = new Date().toISOString();
      setSessions((previous) => {
        const next = previous.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                agencyAgent: agent,
                contextCheckpoint: undefined,
                agentHandoffs:
                  item.messageCount > 0
                    ? [
                        ...(item.agentHandoffs ?? []),
                        {
                          id: handoffId,
                          fromSlug: from.slug,
                          fromTitle: from.title,
                          toSlug: agent.slug,
                          toTitle: agent.title,
                          switchedAt,
                        },
                      ]
                    : item.agentHandoffs,
              }
            : item,
        );
        sessionsRef.current = next;
        return next;
      });
      const login = actorLogin;
      if (login && session.messageCount > 0) {
        persist(
          conversationClient.command(sessionId, {
            kind: "handoff",
            actorLogin: login,
            entryId: handoffId,
            idempotencyKey: handoffId,
            from,
            to: agent,
            createdAt: switchedAt,
          }),
        );
      } else if (login) {
        persist(
          conversationClient.command(sessionId, {
            kind: "set-agent",
            actorLogin: login,
            agent,
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    },
    [actorLogin, conversationClient, persist],
  );

  const setSessionMachineAccess = useCallback(
    (sessionId: string, machineAccess: MachineAccess) => {
      const updatedAt = new Date().toISOString();
      setSessions((previous) => {
        const next = previous.map((session) =>
          session.id === sessionId
            ? { ...session, machineAccess, updatedAt }
            : session,
        );
        sessionsRef.current = next;
        return next;
      });
      const login = actorLogin;
      if (login) {
        persist(
          conversationClient.command(sessionId, {
            kind: "machine-access",
            actorLogin: login,
            machineAccess,
            updatedAt,
          }),
        );
      }
    },
    [actorLogin, conversationClient, persist],
  );

  const setSessionCheckpoint = useCallback(
    (sessionId: string, checkpoint: ConversationCheckpoint) => {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? { ...session, contextCheckpoint: checkpoint }
            : session,
        ),
      );
      const login = actorLogin;
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (login) {
        persist(
          conversationClient.command(sessionId, {
            kind: "checkpoint",
            actorLogin: login,
            version: checkpoint.revision,
            throughSeq: checkpoint.throughMessageCount - 1,
            agentEpochId: session?.agentHandoffs?.at(-1)?.id ?? "initial",
            summary: checkpoint.summary,
            sourceHash: checkpoint.sourceFingerprint,
            createdAt: checkpoint.createdAt,
          }),
        );
      }
    },
    [actorLogin, conversationClient, persist],
  );

  return {
    hydrated,
    sessions: orderedSessions,
    activeSession,
    messages,
    persistenceError,
    persistUserMessage,
    persistAssistantMessage,
    persistPendingAssistantMessage,
    settlePendingAssistantMessage,
    recoverRunningTurn,
    setMessages,
    setSessionMessages,
    getSessionMessages: (sessionId) => messagesBySession[sessionId] ?? [],
    resolveSessionId: (sessionId) => conversationClient.resolveSessionId(sessionId),
    resolveRuntimeSessionId: (sessionId) => conversationClient.resolveRuntimeSessionId(sessionId),
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    pinSession,
    clearActiveSession,
    setSessionAgent,
    setSessionMachineAccess,
    setSessionAgencyAgent,
    setSessionCheckpoint,
  };
}
