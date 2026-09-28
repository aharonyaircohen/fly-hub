/**
 * @fileType types
 * @domain kody | dashboard
 * @pattern chat-persistence
 * @ai-summary Shared types for chat persistence across dashboard and pipeline
 */

import type { ChatViewDirective } from "./chat-ui-actions";
import type { ConversationCheckpoint } from "./chat/core/conversation-compaction";

export interface AgentHandoff {
  id: string;
  fromSlug: string;
  fromTitle: string;
  toSlug: string;
  toTitle: string;
  switchedAt: string;
}

export interface AgencyAgentIdentity {
  slug: string;
  title: string;
}

/**
 * Reference to an attachment stored by the canonical conversation service.
 * The message stores only durable metadata and the storage-backed id.
 */
export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * A single message in a chat conversation.
 * Used for both dashboard chat and pipeline agent sessions.
 */
export interface ChatMessage {
  /** Stable canonical entry id used by Convex persistence. */
  id?: string;
  /** Stable lifecycle id shared with the server-owned durable turn. */
  turnId?: string;
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  timestamp: string;
  model?: string;
  /** Agent that authored an assistant message. */
  agent?: AgencyAgentIdentity;
  /** Tool calls associated with this message (for tool visibility feature) */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "running" | "success" | "error";
    durationMs?: number;
    description?: string;
    activityKind?: "subagent";
    displayName?: string;
  }>;
  /** Attachments uploaded with this message (binaries in Convex storage). */
  attachments?: AttachmentRef[];
  /**
   * True while a reply is being streamed into this message. Persisted so the
   * UI→storage→UI round-trip preserves the in-flight marker; without this,
   * streaming updates can't find the placeholder to append chunks to.
   */
  isLoading?: boolean;
  /**
   * Synthetic message that should remain available to the model but should not
   * render as a visible chat bubble.
   */
  hidden?: boolean;
  /** Optional structured UI rendered under an assistant chat message. */
  view?: ChatViewDirective;
  /** @deprecated Migrated into SessionMeta.agentHandoffs when the store loads. */
  agentHandoff?: AgentHandoff;
}

/**
 * A session of chat messages.
 * For dashboard: a continuous conversation in task mode.
 * For pipeline: one agent stage execution.
 */
export interface ChatSession {
  /** Session type: 'dashboard' for user conversations, or pipeline stage name */
  stage: string;
  /** OpenCode session ID (for pipeline sessions) */
  sessionId?: string;
  /** When this session started */
  startedAt: string;
  /** Messages in this session */
  messages: ChatMessage[];
}

/**
 * Complete chat history for a task.
 * Stored in .tasks/<taskId>/chat.json
 */
export interface ChatHistory {
  /** Schema version */
  version: 1;
  /** Task ID this chat belongs to */
  taskId: string;
  /** All sessions (pipeline + dashboard) */
  sessions: ChatSession[];
}

// ===========================================
// SESSION MANAGEMENT TYPES (v2)
// ===========================================

/**
 * Lightweight session metadata for the session list UI.
 * Stored as a typed conversation checkpoint.
 */
export interface SessionMeta {
  /** Unique session identifier */
  id: string;
  /** User-editable or auto-generated title */
  title: string;
  /**
   * First user message, sliced. Used as the visible label while `title`
   * is still the "New conversation" placeholder (the async LLM auto-title
   * may not have resolved, or the session never completed an exchange).
   * Purely cosmetic — the LLM auto-title effect remains the title owner.
   */
  preview?: string;
  /** When this session was created */
  createdAt: string;
  /** Last message timestamp */
  updatedAt: string;
  /** Number of messages in this session */
  messageCount: number;
  /** Whether this session is pinned */
  pinned?: boolean;
  /** Optional repository context used when this conversation was created. */
  repository?: { owner: string; repo: string };
  /**
   * The chat entry key (from `buildAgentList` — e.g. `"brain"`,
   * `"kody:claude-sonnet"`, `"kody-live"`) the user picked for THIS
   * session. Per-session so switching conversations remembers each
   * thread's chosen assistant instead of a single global default.
   *
   * `undefined` for legacy sessions created before this field existed —
   * render-time fallback to the configured catalog default applies. The next
   * time the user picks an agent in that session, the field is populated.
   */
  agentKey?: string;
  /** Explicit host-machine access for this conversation. */
  machineAccess?: MachineAccess;
  /** Server-validated AI Agency identity currently active in this session. */
  agencyAgent?: AgencyAgentIdentity;
  /** Ordered conversation events; kept outside the user/assistant transcript. */
  agentHandoffs?: AgentHandoff[];
  /** Derived model memory for long conversations; never replaces the transcript. */
  contextCheckpoint?: ConversationCheckpoint;
  /** Ephemeral UI status derived from the stored messages */
  status?: "idle" | "running";
}

/** Machine access is independent from agent identity and model choice. */
export type MachineAccess = "none" | "local" | "brain";

/**
 * UI projection of a canonical conversation.
 * Replaces the v1 format (simple Message[] per agent).
 */
export interface GlobalChatStore {
  /** Schema version */
  version: 3;
  /** Session metadata list */
  sessions: SessionMeta[];
  /** Messages keyed by session ID */
  messages: Record<string, ChatMessage[]>;
  /** Active session ID (single, not per-agent) */
  activeSessionId: string;
}

/**
 * Default empty global chat store
 */
export function createEmptyGlobalStore(): GlobalChatStore {
  return {
    version: 3,
    sessions: [],
    messages: {},
    activeSessionId: "",
  };
}

export interface ScopedAgentContext {
  slug: string;
  title?: string;
  describe?: string;
  body?: string;
}

/**
 * Discriminated union describing what the chat is "about".
 *
 * `null`/absent prop on KodyChat = global chat (no scoped context).
 */
export type ChatContext =
  | {
      /**
       * Chat scoped to a GitHub owner workspace in the dashboard.
       * Broad reads can span repos; writes must still target a concrete repo.
       */
      kind: "org";
      org: string;
      repositories?: Array<{ owner: string; repo: string }>;
    }
  | { kind: "task"; task: import("@kody-ade/base/types").KodyTask }
  | {
      /**
       * Chat scoped to an existing capability (or agent — an agent
       * is a pure agent file that's structurally a subset of a capability and
       * reuses this scope kind). The agent is given the title/body so
       * it can answer questions about that specific capability/agents.
       */
      kind: "capability";
      capability: ScopedAgentContext | import("./integration-api").Agent;
    }
  | {
      /**
       * Chat scoped to a system report family surfaced on `/reports`.
       * The agent receives the report's title + body and is framed to
       * advise whether the user should create an issue from this report or
       * take no action — sometimes a report
       * is informational and needs no follow-up.
       */
      kind: "report";
      report: { slug: string; title: string; body: string; path?: string };
    }
  | {
      /** Safe operational metadata for the App selected on the Apps page. */
      kind: "app";
      app: {
        slug: string;
        repository: string;
        name: string;
        status: string;
        branch: string;
        rootDirectory: string;
        exposure: "private" | "public";
        currentDeploymentId?: string;
        secretNames: string[];
        domains: Array<{ hostname: string; status: string }>;
        storage: Array<{
          volumeId: string;
          name: string;
          mountPath: string;
          sizeGb: number;
        }>;
      };
    };
