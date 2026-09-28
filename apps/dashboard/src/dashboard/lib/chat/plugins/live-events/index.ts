/**
 * @fileType module
 * @domain kody
 * @pattern chat-plugin
 * @ai-summary The live-events chat plugin: supplies the Convex reactive
 *   chat-event stream as the platform's live transport (capability
 *   "live-transport") when NEXT_PUBLIC_CONVEX_URL is set. Without the env
 *   var the plugin registers inert (no capability, no transport) and the
 *   live runner keeps its interval-polling fallback — the dashboard works
 *   identically without Convex.
 */

import type {
  ChatLiveTransport,
  ChatPlugin,
} from "@kody-ade/kody-chat-dashboard/platform";
import { createConvexChatLiveTransport } from "./convex-live-transport";

/** Build-time constant — identical for every render of this deployment. */
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * E2E seam: Playwright can intercept HTTP routes but not the Convex
 * WebSocket, so specs that used to mock /api/kody/events/poll|stream set
 * `window.__kodyLiveTransportMock` (an object with a `subscribe` matching
 * ChatLiveTransport) before the runner subscribes. Resolution is lazy —
 * per subscribe call — so an init-script mock always wins over Convex.
 */
declare global {
  interface Window {
    __kodyLiveTransportMock?: ChatLiveTransport;
  }
}

function withE2eSeam(transport: ChatLiveTransport): ChatLiveTransport {
  return {
    id: transport.id,
    subscribe(sessionId, onEvent) {
      const mock =
        typeof window !== "undefined"
          ? window.__kodyLiveTransportMock
          : undefined;
      return (mock ?? transport).subscribe(sessionId, onEvent);
    },
  };
}

export const liveEventsChatPlugin: ChatPlugin = CONVEX_URL
  ? {
      id: "live-events",
      capabilities: ["live-transport"],
      liveTransport: withE2eSeam(createConvexChatLiveTransport(CONVEX_URL)),
    }
  : {
      id: "live-events",
      capabilities: [],
    };
