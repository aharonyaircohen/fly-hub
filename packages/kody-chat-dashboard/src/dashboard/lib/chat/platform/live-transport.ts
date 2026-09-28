/**
 * @fileType module
 * @domain chat-platform
 * @pattern live-transport-contract
 * @ai-summary The ChatLiveTransport contract — the sanctioned lifecycle/stream
 *   hook that lets a PLUGIN supply the live chat-event stream (e.g. a Convex
 *   reactive subscription) in place of the core interval-polling fallback,
 *   without ever importing core stream internals. A plugin declares
 *   `liveTransport` on its manifest (capability "live-transport"); the
 *   registry publishes it into this module-scope singleton (same pattern as
 *   the server-tool registry), and the surface's live runner consults
 *   `getChatLiveTransport()` when it opens a session event stream. No
 *   registered transport = current polling behavior, unchanged.
 */

/**
 * One chat event from the runner's event stream, in the same shape the
 * backend event stream provides:
 * `{ event: "chat.message", payload: {...} }`. Transports must emit each
 * event exactly once, in seq order — the consumer does no deduplication.
 */
export interface ChatLiveTransportEvent {
  event: string;
  payload: Record<string, unknown>;
}

export interface ChatLiveTransport {
  /** Stable id for diagnostics and last-wins replacement. */
  id: string;
  /**
   * Start streaming events for a runner session. Returns an unsubscribe
   * function; after it is called no further `onEvent` calls may fire.
   */
  subscribe(
    sessionId: string,
    onEvent: (event: ChatLiveTransportEvent) => void,
  ): () => void;
}

// Module-scope singleton, mirroring the server-tools registry precedent:
// KodyChat mounts twice and each mount registers the same plugin list, so
// registration must be idempotent — re-registering the same transport (or
// a newer one, last wins) simply replaces the slot.
let activeTransport: ChatLiveTransport | null = null;

export function registerChatLiveTransport(transport: ChatLiveTransport): void {
  activeTransport = transport;
}

/** The currently registered live transport, or null (→ polling fallback). */
export function getChatLiveTransport(): ChatLiveTransport | null {
  return activeTransport;
}

/** Test-only: clear the singleton between specs. */
export function resetChatLiveTransportForTests(): void {
  activeTransport = null;
}
