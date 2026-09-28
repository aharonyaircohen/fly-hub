/**
 * @fileType util
 * @domain kody
 * @pattern chat-events-reader
 *
 * Shared reader for a chat session's event stream, backed by the Convex
 * `chatEvents` table (previously `events/{sessionId}.jsonl` in the state
 * repo via Octokit). Used by /api/kody/events/poll, /api/kody/events/stream
 * and the session status route so the storage choke point lives in one
 * place — the routes still speak "lines" (JSON strings) so their response
 * contracts are unchanged.
 *
 * The octokit/owner/repo/branch parameters are retained for signature
 * compatibility with the backend era; Convex reads ignore them.
 */

import type { Octokit } from "@octokit/rest";
import { readChatEvents } from "./chat-events-store";

export function sessionEventsFilePath(sessionId: string): string {
  return `events/${sessionId}.jsonl`;
}

export interface ReadEventsResult {
  lines: string[];
  exists: boolean;
  /** Retained from the ETag-cache era; Convex reads are always fresh. */
  fromCache: boolean;
}

export async function readEventsFile(
  _octokit: Octokit,
  _owner: string,
  _repo: string,
  _branch: string,
  sessionId: string,
): Promise<ReadEventsResult> {
  const { events } = await readChatEvents(sessionId);
  return {
    lines: events.map((event) => JSON.stringify(event)),
    exists: events.length > 0,
    fromCache: false,
  };
}

/**
 * No-op retained for API compatibility — there is no per-session cache to
 * clear now that reads go straight to Convex.
 */
export function clearEventsCache(_sessionId: string): void {}
