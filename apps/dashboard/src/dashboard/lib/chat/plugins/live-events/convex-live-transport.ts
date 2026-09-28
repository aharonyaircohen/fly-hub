/**
 * @fileType module
 * @domain kody
 * @pattern chat-live-transport
 * @ai-summary Convex-backed ChatLiveTransport: streams a runner session's
 *   chat events through a reactive chatEvents.since subscription (the same
 *   deliberately public query useChatEventsLive uses) instead of the core's
 *   3s interval poll. Tracks a per-subscription seq watermark so each event
 *   is emitted exactly once in order, and key-unescapes stored payloads
 *   (Convex reserves $/_ prefixes). Pure module — no React; uses
 *   ConvexClient (convex/browser) so the transport works from the
 *   imperative live-runner code path.
 */

import { ConvexClient } from "convex/browser";
import { api as backendApi } from "@kody-ade/backend/api";
import { deepUnescapeKeys } from "@kody-ade/backend/escape-keys";
import type {
  ChatLiveTransport,
  ChatLiveTransportEvent,
} from "@kody-ade/kody-chat-dashboard/platform";

/** Chat events live under a single global tenant — see chat-events-store.ts. */
const CHAT_EVENTS_TENANT = "global";

interface ChatEventDoc {
  seq: number;
  event: unknown;
}

// One shared reactive client per deployment URL (module scope — mirrors
// ConvexClientProvider's singleton ConvexReactClient).
let sharedClient: ConvexClient | null = null;
let sharedClientUrl: string | null = null;

function getConvexClient(url: string): ConvexClient {
  if (!sharedClient || sharedClientUrl !== url) {
    sharedClient = new ConvexClient(url);
    sharedClientUrl = url;
  }
  return sharedClient;
}

function toTransportEvent(raw: unknown): ChatLiveTransportEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const evt = raw as { event?: unknown; payload?: unknown };
  if (typeof evt.event !== "string" || evt.event.length === 0) return null;
  const payload =
    evt.payload && typeof evt.payload === "object"
      ? (evt.payload as Record<string, unknown>)
      : {};
  return { event: evt.event, payload };
}

/**
 * Build the transport. `subscribe` opens a chatEvents.since reactive query
 * for the session; every update delivers the full tail, so the seq
 * watermark forwards only the not-yet-seen suffix to `onEvent`.
 */
export function createConvexChatLiveTransport(url: string): ChatLiveTransport {
  return {
    id: "convex-chat-events",
    subscribe(sessionId, onEvent) {
      const client = getConvexClient(url);
      let lastSeq = -1;
      let stopped = false;
      const unsubscribe = client.onUpdate(
        backendApi.chatEvents.since,
        { tenantId: CHAT_EVENTS_TENANT, sessionId, afterSeq: -1 },
        (docs: unknown) => {
          if (stopped || !Array.isArray(docs)) return;
          for (const doc of docs as ChatEventDoc[]) {
            if (typeof doc?.seq !== "number" || doc.seq <= lastSeq) continue;
            lastSeq = doc.seq;
            // Stored payloads are key-escaped (Convex reserves $/_ prefixes);
            // subscriptions bypass the wrapped HTTP client, so unescape here.
            const event = toTransportEvent(deepUnescapeKeys(doc.event));
            if (event) onEvent(event);
          }
        },
      );
      return () => {
        stopped = true;
        unsubscribe();
      };
    },
  };
}
