/**
 * @fileType data
 * @domain kody
 * @pattern agent-data
 * @ai-summary UI-free agent data shared below the chat layer. The full agent
 *   registry (icons, capabilities, backend routing) lives in
 *   kody-chat/src/dashboard/lib/agents.ts; this module holds only the pure
 *   pieces that non-chat packages (e.g. @kody-ade/workspace instruction
 *   routes) need, so they don't have to import the UI-flavored module.
 */

/**
 * Placeholder system prompt for the in-process Kody agent
 * (`AGENT_KODY.systemPrompt`). The actual prompt is composed at runtime from
 * the chat-defaults bundle via `composeBasePrompt(bundle)` — this string is
 * what code paths that read `agent.systemPrompt` directly see.
 */
export const AGENT_KODY_SYSTEM_PROMPT =
  "Kody — in-process dashboard chat agent. See chat-defaults bundle for the live prompt.";
