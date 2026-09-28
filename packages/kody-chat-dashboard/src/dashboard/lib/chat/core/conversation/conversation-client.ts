import type { ChatViewDirective } from "../../../chat-ui-actions";
import type { MachineAccess } from "../../../chat-types";
import type {
  AgentIdentity,
  ConversationRuntime,
  MessageStatus,
} from "./prepare-turn";

export type { ConversationRuntime } from "./prepare-turn";

export type ConversationCommand =
  | {
      kind: "append-message";
      actorLogin: string;
      entryId: string;
      idempotencyKey: string;
      role: "user" | "assistant";
      agent?: { slug: string; title: string };
      content: string;
      view?: ChatViewDirective;
      status: MessageStatus;
      turnId: string;
      attachmentIds?: string[];
      createdAt: string;
    }
  | {
      kind: "update-message";
      actorLogin: string;
      entryId: string;
      content: string;
      view?: ChatViewDirective;
      status: MessageStatus;
      updatedAt: string;
    }
  | {
      kind: "remove-message";
      actorLogin: string;
      entryId: string;
    }
  | {
      kind: "set-agent";
      actorLogin: string;
      agent: AgentIdentity;
      updatedAt: string;
    }
  | {
      kind: "handoff";
      actorLogin: string;
      entryId: string;
      idempotencyKey: string;
      from: AgentIdentity;
      to: AgentIdentity;
      createdAt: string;
    }
  | {
      kind: "runtime";
      actorLogin: string;
      runtime: ConversationRuntime;
      updatedAt: string;
    }
  | {
      kind: "machine-access";
      actorLogin: string;
      machineAccess: MachineAccess;
      updatedAt: string;
    }
  | {
      kind: "checkpoint";
      actorLogin: string;
      version: number;
      throughSeq: number;
      agentEpochId: string;
      summary: string;
      sourceHash: string;
      createdAt: string;
    }
  | { kind: "clear"; actorLogin: string };

type HermesListResponse = {
  sessions: Array<Record<string, unknown>>;
};

function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 100_000_000_000 ? value * 1_000 : value).toISOString();
  }
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return fallback;
}

function fromHermesSession(session: Record<string, unknown>) {
  const id = String(session.id ?? session.session_id ?? "");
  const now = new Date().toISOString();
  const started = asIsoDate(session.started_at, now);
  const updated = asIsoDate(session.last_active ?? session.started_at, started);
  return {
    conversationId: id,
    title: String(session.title ?? "New conversation"),
    preview: typeof session.preview === "string" ? session.preview : undefined,
    messageCount: typeof session.message_count === "number" ? session.message_count : 0,
    pinned: session.pinned === true,
    scope: { kind: "global" as const },
    activeAgent: { slug: "hermes", title: "Hermes" },
    runtime: { kind: "direct", modelId: String(session.model ?? "default") },
    machineAccess: "none" as const,
    createdAt: started,
    updatedAt: updated,
  };
}

function toConversationDetail(payload: {
  session?: Record<string, unknown>;
  history?: { messages?: Array<Record<string, unknown>> };
}) {
  const session = fromHermesSession(payload.session ?? {});
  const entries = (payload.history?.messages ?? []).flatMap((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    return [{
      entryId: String(message.id ?? `${session.conversationId}:${index}`),
      seq: index,
      entry: {
        kind: "message" as const,
        role: message.role,
        content: typeof message.content === "string" ? message.content : "",
        status: "committed" as const,
        createdAt: asIsoDate(message.timestamp, new Date().toISOString()),
      },
    }];
  });
  return {
    conversation: session,
    entries,
    turns: [],
    checkpoints: [],
  };
}

const browserFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

export class ConversationClient {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sessionSources = new Map<string, string>();
  private readonly sessionTitles = new Map<string, string>();
  private readonly sessionIds = new Map<string, { storedId: string; runtimeId?: string }>();
  private readonly creations = new Map<string, Promise<void>>();

  constructor(
    private readonly fetcher: typeof fetch = browserFetch,
    private readonly headers: () => Record<string, string> = () => ({}),
  ) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(url, {
      ...init,
      cache: "no-store",
      headers: {
        ...this.headers(),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      const message =
        typeof body?.message === "string" && body.message.trim()
          ? body.message
          : `Conversation request failed (${response.status})`;
      throw new Error(message);
    }
    return (await response.json()) as T;
  }

  async list(
    surface: "global" | "vibe-default" = "global",
  ): Promise<Array<Record<string, unknown>>> {
    const source = surface === "vibe-default" ? "kody-vibe-default" : "kody-global";
    const result = await this.request<HermesListResponse>(
      `/api/kody/hermes/sessions?limit=100&source=${encodeURIComponent(source)}`,
    );
    return result.sessions.map((session) => {
      const mapped = fromHermesSession(session);
      this.sessionSources.set(mapped.conversationId, String(session.source ?? source));
      this.sessionTitles.set(mapped.conversationId, mapped.title);
      this.sessionIds.set(mapped.conversationId, { storedId: mapped.conversationId });
      return mapped;
    });
  }

  async get(conversationId: string): Promise<Record<string, unknown>> {
    const storedId = await this.resolveSessionId(conversationId);
    const payload = await this.request<{
      session?: Record<string, unknown>;
      history?: { messages?: Array<Record<string, unknown>> };
    }>(
      `/api/kody/hermes/sessions/${encodeURIComponent(storedId)}`,
    );
    if (payload.session) {
      this.sessionSources.set(conversationId, String(payload.session.source ?? "kody-global"));
      this.sessionTitles.set(conversationId, String(payload.session.title ?? "New conversation"));
      this.sessionIds.set(conversationId, { storedId });
    }
    const detail = toConversationDetail(payload);
    return { ...detail, conversation: { ...detail.conversation, conversationId } };
  }

  create(
    input: Record<string, unknown> & { conversationId: string },
  ): Promise<void> {
    const creation = this.enqueue(input.conversationId, async () => {
      const surface = input.surface === "vibe-default" ? "kody-vibe-default" : "kody-global";
      this.sessionSources.set(input.conversationId, surface);
      this.sessionTitles.set(input.conversationId, String(input.title ?? "New conversation"));
      const result = await this.request<{
        id?: unknown;
        session_id?: unknown;
        stored_session_id?: unknown;
      }>("/api/kody/hermes/sessions", {
        method: "POST",
        body: JSON.stringify({
          sessionId: input.conversationId,
          title: input.title,
          source: surface,
        }),
      });
      const storedId = String(result.stored_session_id ?? result.id ?? "");
      if (!storedId) throw new Error("Hermes returned no stored session id.");
      this.sessionIds.set(input.conversationId, {
        storedId,
        ...(typeof result.session_id === "string" ? { runtimeId: result.session_id } : {}),
      });
    });
    this.creations.set(input.conversationId, creation);
    return creation;
  }

  async resolveSessionId(sessionId: string): Promise<string> {
    await this.creations.get(sessionId);
    return this.sessionIds.get(sessionId)?.storedId ?? sessionId;
  }

  async resolveRuntimeSessionId(sessionId: string): Promise<string | undefined> {
    await this.creations.get(sessionId);
    return this.sessionIds.get(sessionId)?.runtimeId;
  }

  command(conversationId: string, command: ConversationCommand): Promise<void> {
    // Hermes stores real user/assistant turns through /chat/stream. UI-only
    // messages and tool progress stay in the current browser session.
    if (command.kind === "clear") {
      const clearing = this.enqueue(conversationId, async () => {
        const previousId = this.sessionIds.get(conversationId)?.storedId ?? conversationId;
        await this.request(`/api/kody/hermes/sessions/${encodeURIComponent(previousId)}`, {
          method: "DELETE",
          body: JSON.stringify({ runtimeSessionId: this.sessionIds.get(conversationId)?.runtimeId }),
        });
        const replacement = await this.request<{ stored_session_id?: string; session_id?: string }>("/api/kody/hermes/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: this.sessionTitles.get(conversationId) ?? "New conversation",
            source: this.sessionSources.get(conversationId) ?? "kody-global",
          }),
        });
        if (!replacement.stored_session_id) throw new Error("Hermes returned no stored session id.");
        this.sessionIds.set(conversationId, {
          storedId: replacement.stored_session_id,
          runtimeId: replacement.session_id,
        });
      });
      this.creations.set(conversationId, clearing);
      return clearing;
    }
    return Promise.resolve();
  }

  private enqueue(
    conversationId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(conversationId, next);
    const clearCompletedQueue = () => {
      if (this.queues.get(conversationId) === next) {
        this.queues.delete(conversationId);
      }
    };
    void next.then(clearCompletedQueue, clearCompletedQueue);
    return next;
  }

  async updateMetadata(
    conversationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const storedId = await this.resolveSessionId(conversationId);
    await this.request(
      `/api/kody/hermes/sessions/${encodeURIComponent(storedId)}`,
      { method: "PATCH", body: JSON.stringify({
        ...metadata, runtimeSessionId: this.sessionIds.get(conversationId)?.runtimeId,
      }) },
    );
  }

  remove(conversationId: string): Promise<void> {
    return this.enqueue(conversationId, async () => {
      const storedId = this.sessionIds.get(conversationId)?.storedId ?? conversationId;
      await this.request(
        `/api/kody/hermes/sessions/${encodeURIComponent(storedId)}`,
        { method: "DELETE", body: JSON.stringify({
          runtimeSessionId: this.sessionIds.get(conversationId)?.runtimeId,
        }) },
      );
      this.sessionSources.delete(conversationId);
      this.sessionTitles.delete(conversationId);
      this.sessionIds.delete(conversationId);
      this.creations.delete(conversationId);
    });
  }
}

export const conversationClient = new ConversationClient();

export function createConversationClient(
  headers: Record<string, string>,
  fetcher: typeof fetch = browserFetch,
): ConversationClient {
  return new ConversationClient(fetcher, () => headers);
}
