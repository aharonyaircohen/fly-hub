/**
 * @fileType utility
 * @domain kody
 * @pattern chat-events-store
 * @ai-summary Convex-backed chat event stream (chatEvents.{append,since}).
 *   Replaces the events/<sessionId>.jsonl backend file as the durability
 *   layer behind /api/kody/events/{ingest,poll,stream}. Chat sessionIds are
 *   globally unique, so events live under a single "global" tenant — the
 *   ingest side (engine HMAC token, no repo context) and the read side
 *   (dashboard, per-repo auth) always agree on the scope.
 */

import { backendApi, getConvexClient } from "./backend/convex-backend";

/** Single tenant scope for chat events — see @ai-summary. */
export const CHAT_EVENTS_TENANT = "global";

export interface ChatEventRecord {
  event: string;
  payload: unknown;
  runId: string;
  emittedAt: string;
}

interface ChatEventDoc {
  seq: number;
  event: ChatEventRecord;
}

/** Append a batch of engine events to a session's Convex stream. */
export async function appendChatEvents(
  sessionId: string,
  events: ChatEventRecord[],
): Promise<void> {
  const client = getConvexClient();
  for (const event of events) {
    await client.mutation(backendApi.chatEvents.append, {
      tenantId: CHAT_EVENTS_TENANT,
      sessionId,
      event,
    });
  }
}

/** Read a session's events after `afterSeq` (use -1 for "from the start"). */
export async function readChatEvents(
  sessionId: string,
  afterSeq = -1,
): Promise<{ events: ChatEventRecord[]; lastSeq: number }> {
  const docs = (await getConvexClient().query(backendApi.chatEvents.since, {
    tenantId: CHAT_EVENTS_TENANT,
    sessionId,
    afterSeq,
  })) as ChatEventDoc[];
  return {
    events: docs.map((doc) => doc.event),
    lastSeq: docs.at(-1)?.seq ?? afterSeq,
  };
}
