/**
 * @fileType module
 * @domain chat-platform
 * @pattern server-tool-registry-singleton
 * @ai-summary Server-only entry point for the plugin tool registry (plan H3,
 *   Step 4). Module-scope singleton: plugin server halves register their tool
 *   factories here at module load; the in-process kody chat route collects
 *   them per request and merges them into its tool map. This file is
 *   intentionally NOT re-exported from platform/index.ts — the index is
 *   imported by client surfaces, and this module must never enter the client
 *   bundle (`import "server-only"` makes that a build error).
 */

import "server-only";

import {
  createChatServerToolRegistry,
  type ChatServerToolRegistry,
} from "./tools";

/**
 * The one registry instance for the server process. Unlike the client
 * plugin registry (per KodyChat mount — plan H4), server tools have no
 * per-mount state: a tool factory is pure registration data and the
 * route materializes tools per request via `collect(ctx)`.
 */
const registry: ChatServerToolRegistry = createChatServerToolRegistry();

export function getChatServerToolRegistry(): ChatServerToolRegistry {
  return registry;
}
