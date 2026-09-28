/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern send-middleware
 * @ai-summary Terminal-intent send middleware (order 100 — pinned to run
 *   before slash expansion at order 200, Step 5b). `/terminal <intent>` is
 *   routed through Kody first: the middleware rewrites the outgoing text to
 *   the Kody terminal prompt and dispatches a host effect carrying the raw
 *   typed text (for the visible bubble) and the parsed intent; the host
 *   forces the in-process `kody` agent and pipes the returned terminal
 *   block into the terminal surface.
 */
import {
  buildKodyTerminalPrompt,
  parseKodyTerminalIntent,
} from "@kody-ade/terminal/kody-terminal-directive";
import type { ChatHostEffect, ChatSendMiddleware } from "../../platform";

export const TERMINAL_INTENT_MIDDLEWARE_ID = "terminal-intent";
export const TERMINAL_INTENT_MIDDLEWARE_ORDER = 100;
export const TERMINAL_INTENT_EFFECT = "terminal:intent";

export interface TerminalIntentEffectPayload {
  /** The raw text the user typed (shown in the user bubble). */
  rawText: string;
  /** The parsed terminal intent. */
  intent: string;
  /** The Kody prompt the model receives instead of the raw text. */
  prompt: string;
}

export function readTerminalIntentEffect(
  effect: ChatHostEffect,
): TerminalIntentEffectPayload | null {
  if (effect.kind !== TERMINAL_INTENT_EFFECT) return null;
  const payload = effect.payload as Partial<TerminalIntentEffectPayload>;
  if (
    typeof payload?.rawText !== "string" ||
    typeof payload?.intent !== "string" ||
    typeof payload?.prompt !== "string"
  ) {
    return null;
  }
  return {
    rawText: payload.rawText,
    intent: payload.intent,
    prompt: payload.prompt,
  };
}

export const terminalIntentMiddleware: ChatSendMiddleware = {
  id: TERMINAL_INTENT_MIDDLEWARE_ID,
  order: TERMINAL_INTENT_MIDDLEWARE_ORDER,
  onSend(text, ctx) {
    const parsed = parseKodyTerminalIntent(text);
    if (!parsed) return null;
    const prompt = buildKodyTerminalPrompt(parsed.intent);
    ctx.dispatchHostEffect({
      kind: TERMINAL_INTENT_EFFECT,
      payload: {
        rawText: text,
        intent: parsed.intent,
        prompt,
      } satisfies TerminalIntentEffectPayload,
    });
    return { text: prompt };
  },
};
