/**
 * @fileType util
 * @domain kody
 * @pattern interactive-session
 *
 * Server-side helpers for the long-lived "interactive runner" chat mode.
 * Interactive runners and the browser share the canonical Convex
 * conversation timeline. GitHub dispatch only starts the runner.
 *
 * Why this lives in its own module: the existing trigger route does
 * dispatch-per-turn and assumes one workflow run = one reply. Interactive
 * mode breaks that — start() dispatches once, then append() writes to the
 * shared conversation without triggering anything new.
 *
 * Auth model is the same inline HMAC token as one-shot chat — see
 * chat-token.ts. The runner verifies the token on ingest POSTs so we
 * don't need a shared session-state DB.
 */

import type { Octokit } from "@octokit/rest";
import { logger } from "@kody-ade/base/logger";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "./backend/convex-backend";

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
 * Writes the meta line as the (initial) content of the session file. Use at
 * the start of an interactive session.
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
 * Concurrency: each start commits a (distinct) session file to the same
 * branch, so two starts firing at once race on the branch HEAD — the loser
 * gets a 409 ("<path> is at <sha> but expected <sha>"). Without a retry that
 * surfaces as a 500 to the user (observed when two Vibe runs start together).
 * We retry on 409 with a small jittered backoff so concurrent starters
 * desynchronise and both land — same pattern appendUserTurn uses.
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
 * Reads the existing session file, appends a single user turn, writes back.
 * Returns the new turn count so the caller can update local UI watermarks.
 *
 * Race window: if the runner pushes between our read and write, the sha
 * check fails and we retry once. Beyond that, surface the error — the
 * caller can decide to fall back to a fresh dispatch.
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
  return { turnCount: await convexTurnCount(owner, repo, sessionId) };
}

/**
 * Read a session's transcript from the Convex record
 * Returns null when the canonical conversation does not exist.
 */
export async function readSessionTranscript(
  owner: string,
  repo: string,
  sessionId: string,
): Promise<{ meta: SessionMeta; turns: ChatTurn[] } | null> {
  const result = (await getConvexClient().query(backendApi.conversations.get, {
    tenantId: tenantIdFor(owner, repo),
    conversationId: sessionId,
  })) as {
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
    turns: [...result.entries]
      .sort((a, b) => a.seq - b.seq)
      .filter(
        (doc) =>
          doc.entry.kind === "message" &&
          doc.entry.role &&
          doc.entry.content !== undefined,
      )
      .map((doc) => ({
        role: doc.entry.role!,
        content: doc.entry.content!,
        timestamp: doc.entry.createdAt,
      })),
  };
}

// ─── Convex transcript record ──────────────────────────────────────────────
// Convex is the sole durable transcript record. The engine polls these records
// directly when its Actions secrets are present.

export async function recordSessionStart(
  owner: string,
  repo: string,
  sessionId: string,
  meta: SessionMeta,
  initialTurn?: ChatTurn,
): Promise<void> {
  try {
    const client = getConvexClient();
    const tenantId = tenantIdFor(owner, repo);
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
      // The chat UI creates the conversation before the user can select the
      // live model. Reusing that conversation without changing its runtime
      // makes the engine take the one-shot path and reject an empty warm-up
      // with "nothing to reply to" instead of emitting chat.ready.
      await client.mutation(backendApi.conversations.updateRuntime, {
        tenantId,
        conversationId: sessionId,
        runtime: { kind: "live", profileId: "kody-live" },
        updatedAt: meta.createdAt,
      });
    }
    if (initialTurn) {
      await recordTurn(owner, repo, sessionId, initialTurn);
    }
  } catch (err) {
    logger.error(
      { err, sessionId },
      "interactive-session: convex session start record failed",
    );
    throw err;
  }
}

export async function recordTurn(
  owner: string,
  repo: string,
  sessionId: string,
  turn: ChatTurn,
): Promise<void> {
  try {
    const client = getConvexClient();
    const tenantId = tenantIdFor(owner, repo);
    const detail = (await client.query(backendApi.conversations.get, {
      tenantId,
      conversationId: sessionId,
    })) as { conversation: { activeAgent: { slug: string; title: string } } };
    const normalized = normalizeTurn(turn);
    const entryId = `${sessionId}:${turn.role}:${turn.timestamp}`;
    await client.mutation(backendApi.conversations.appendEntry, {
      tenantId,
      conversationId: sessionId,
      entryId,
      idempotencyKey: entryId,
      entry: {
        kind: "message",
        role: normalized.role,
        author:
          normalized.role === "user"
            ? { kind: "user", actorId: "system:interactive-runner" }
            : { kind: "agent", ...detail.conversation.activeAgent },
        content: normalized.content,
        status: "committed",
        turnId: entryId,
        createdAt: normalized.timestamp,
      },
    });
  } catch (err) {
    logger.error(
      { err, sessionId },
      "interactive-session: convex turn record failed",
    );
    throw err;
  }
}

/** Turn count from the Convex record (used when the legacy write is off). */
async function convexTurnCount(
  owner: string,
  repo: string,
  sessionId: string,
): Promise<number> {
  try {
    const detail = (await getConvexClient().query(
      backendApi.conversations.get,
      {
        tenantId: tenantIdFor(owner, repo),
        conversationId: sessionId,
      },
    )) as { entries: Array<{ entry: { kind: string } }> } | null;
    return (
      detail?.entries.filter((entry) => entry.entry.kind === "message")
        .length ?? 0
    );
  } catch (err) {
    logger.error(
      { err, sessionId },
      "interactive-session: convex turn count failed",
    );
    return 0;
  }
}

function normalizeTurn(turn: ChatTurn): ChatTurn {
  return {
    role: turn.role,
    content: turn.content,
    timestamp: turn.timestamp,
    toolCalls: turn.toolCalls ?? [],
  };
}

// ─── internals ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
