/**
 * @fileType util
 * @domain kody
 * @pattern standalone-interactive-session
 *
 * Server-side helpers for the long-lived "interactive runner" chat mode.
 * Interactive runners and the browser share the canonical Convex
 * conversation timeline. GitHub dispatch only starts the runner.
 *
 * Why this lives in its own module: the existing trigger route does
 * dispatch-per-turn and assumes one workflow run = one reply. Interactive
 * mode breaks that — start() dispatches once, then append() writes to the
 * Convex transcript without triggering anything new.
 *
 * Auth model is the same inline HMAC token as one-shot chat — see
 * chat-token.ts. The runner verifies the token on ingest POSTs so we
 * don't need a shared session-state DB.
 */

import type { Octokit } from "@octokit/rest";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

const SESSION_DIR = "sessions";
const DEFAULT_BRANCH = "main";

/** Meta line written as the first JSONL row. The engine reads it via readMeta. */
export interface SessionMeta {
  type: "meta";
  mode: "interactive" | "one-shot";
  createdAt: string;
  /** Idle window before the runner exits (default: 5min in engine). */
  idleExitMs?: number;
  /** Hard cap on session lifetime (default: 30min in engine, max 360min via GHA). */
  hardCapMs?: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: unknown[];
}

export function sessionFilePath(sessionId: string): string {
  return `${SESSION_DIR}/${sessionId}.jsonl`;
}

export function buildMetaLine(
  opts: { idleExitMs?: number; hardCapMs?: number } = {},
): SessionMeta {
  return {
    type: "meta",
    mode: "interactive",
    createdAt: new Date().toISOString(),
    ...(opts.idleExitMs !== undefined ? { idleExitMs: opts.idleExitMs } : {}),
    ...(opts.hardCapMs !== undefined ? { hardCapMs: opts.hardCapMs } : {}),
  };
}

/**
 * Writes the meta record at the start of an interactive session.
 *
 * `initialTurn` (optional): when provided, the first user turn is written in
 * the SAME commit as the meta line, so the runner sees it on its first read.
 * This is load-bearing for the vibe auto-kickoff: previously the kickoff turn
 * was written by a SECOND request (`/interactive/append`) right after this
 * one, and the two writes raced on the branch HEAD — the append's turn was
 * frequently lost, leaving a meta-only session. The runner then booted, found
 * no turn, and idle-exited with turnsCompleted:0 (the "handoff ran but nothing
 * happened / chat sits silent" bug). Folding the first turn into the meta
 * write removes that race entirely.
 *
 * Convex mutations provide the durable write boundary for concurrent starts.
 */
export async function writeSessionMeta(
  octokit: Octokit,
  owner: string,
  repo: string,
  sessionId: string,
  meta: SessionMeta,
  _branch: string = DEFAULT_BRANCH,
  _maxRetries = 4,
  initialTurn?: ChatTurn,
): Promise<void> {
  await recordSessionStart(owner, repo, sessionId, meta, initialTurn);
}

/**
 * Appends a single user turn to the Convex transcript.
 * Returns the new turn count so the caller can update local UI watermarks.
 *
 */
export async function appendUserTurn(
  octokit: Octokit,
  owner: string,
  repo: string,
  sessionId: string,
  turn: ChatTurn,
  _branch: string = DEFAULT_BRANCH,
  _maxRetries = 3,
): Promise<{ turnCount: number }> {
  await recordTurn(owner, repo, sessionId, turn);
  const detail = await createBackendClient().query(
    backendApi.conversations.get,
    {
      tenantId: `${owner}/${repo}`,
      conversationId: sessionId,
    },
  );
  return {
    turnCount: (
      (detail as { entries?: Array<{ entry: { kind: string } }> } | null)
        ?.entries ?? []
    ).filter((entry) => entry.entry.kind === "message").length,
  };
}

export async function readSessionTranscript(
  owner: string,
  repo: string,
  sessionId: string,
) {
  const result = (await createBackendClient().query(
    backendApi.conversations.get,
    {
      tenantId: `${owner}/${repo}`,
      conversationId: sessionId,
    },
  )) as {
    entries: Array<{
      seq: number;
      entry: {
        kind: string;
        role?: "user" | "assistant";
        content?: string;
        createdAt: string;
      };
    }>;
  } | null;
  if (!result) return null;
  return {
    meta: buildMetaLine(),
    turns: result.entries
      .sort((a, b) => a.seq - b.seq)
      .filter(
        (item) =>
          item.entry.kind === "message" &&
          item.entry.role &&
          item.entry.content !== undefined,
      )
      .map((item) => ({
        role: item.entry.role!,
        content: item.entry.content!,
        timestamp: item.entry.createdAt,
      })),
  };
}

export async function recordSessionStart(
  owner: string,
  repo: string,
  sessionId: string,
  meta: SessionMeta,
  initialTurn?: ChatTurn,
): Promise<void> {
  const client = createBackendClient();
  const tenantId = `${owner}/${repo}`;
  const existing = await client.query(backendApi.conversations.get, {
    tenantId,
    conversationId: sessionId,
  });
  if (!existing) {
    await client.mutation(backendApi.conversations.create, {
      tenantId,
      conversationId: sessionId,
      surface: "global",
      scope: { kind: "repository", owner, repo },
      title: "New conversation",
      pinned: false,
      activeAgent: { slug: "kody", title: "Kody" },
      runtime: { kind: "live", profileId: "kody-live" },
      createdBy: "system:interactive-runner",
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
    });
  } else {
    // The host may create the conversation before the user selects the live
    // model. Promote that existing direct record so the engine boots its
    // interactive loop and emits chat.ready even before the first message.
    await client.mutation(backendApi.conversations.updateRuntime, {
      tenantId,
      conversationId: sessionId,
      runtime: { kind: "live", profileId: "kody-live" },
      updatedAt: meta.createdAt,
    });
  }
  if (initialTurn) await recordTurn(owner, repo, sessionId, initialTurn);
}

export async function recordTurn(
  owner: string,
  repo: string,
  sessionId: string,
  turn: ChatTurn,
): Promise<void> {
  const client = createBackendClient();
  const tenantId = `${owner}/${repo}`;
  const detail = (await client.query(backendApi.conversations.get, {
    tenantId,
    conversationId: sessionId,
  })) as { conversation: { activeAgent: { slug: string; title: string } } };
  const entryId = `${sessionId}:${turn.role}:${turn.timestamp}`;
  await client.mutation(backendApi.conversations.appendEntry, {
    tenantId,
    conversationId: sessionId,
    entryId,
    idempotencyKey: entryId,
    entry: {
      kind: "message",
      role: turn.role,
      author:
        turn.role === "user"
          ? { kind: "user", actorId: "system:interactive-runner" }
          : { kind: "agent", ...detail.conversation.activeAgent },
      content: turn.content,
      status: "committed",
      turnId: entryId,
      createdAt: turn.timestamp,
    },
  });
}
