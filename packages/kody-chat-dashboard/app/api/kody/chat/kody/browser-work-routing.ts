/**
 * Detect an external website task without binding Chat to any provider or site.
 * The result only forces Capability discovery; permissions still come from the
 * selected Capability contract and execution still belongs to the active View.
 */
import { readUserBrowserGrant } from "@kody-ade/agency/capabilities";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isUserBrowserCapabilityReadResult(result: unknown): boolean {
  const value = record(result);
  const capability = record(value?.capability ?? value);
  const contract =
    typeof capability?.contract === "string" ? capability.contract : null;
  try {
    return readUserBrowserGrant(contract) !== null;
  } catch {
    return false;
  }
}

export function isUserBrowserWorkRequest(input: {
  userText: string | null | undefined;
  previewContext?: string | null;
}): boolean {
  const text = input.userText?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (!text) return false;

  const namesBrowserSurface =
    /\b(?:browser|website|webpage|web page|site|views? session)\b/.test(text);
  const hasVisiblePreview = Boolean(input.previewContext?.trim());
  if (!namesBrowserSurface && !hasVisiblePreview) return false;

  return /\b(?:click|compose|enter|fill|log\s*in|navigate|open|post|press|publish|scroll|select|sign\s*in|submit|type|upload)\b/.test(
    text,
  );
}

type UserBrowserTool =
  | "list_capabilities"
  | "read_capability"
  | "browser_capability_act"
  | "final_answer";

const USER_BROWSER_TURN_TOOLS = new Set<UserBrowserTool>([
  "list_capabilities",
  "read_capability",
  "browser_capability_act",
  "final_answer",
]);

/**
 * Isolate a browser turn before prompts, approval wrappers, or specialists are
 * assembled. The phase state machine below narrows this lane further per step.
 */
export function isolateUserBrowserTurnTools<T>(
  tools: Record<string, T>,
  browserTurn: boolean,
): Record<string, T> {
  if (!browserTurn) return tools;
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) =>
      USER_BROWSER_TURN_TOOLS.has(name as UserBrowserTool),
    ),
  );
}

/**
 * Keep the complete scoped browser tool lane available for the turn. The
 * individual tools enforce capability grants, so a phase gate only makes the
 * model stop after discovery when it should continue to reading and acting.
 */
export function selectUserBrowserActiveTools(input: {
  requested: boolean;
  continuation: boolean;
  capabilitiesListed: boolean;
  browserCapabilityRead: boolean;
  availableTools: readonly string[];
}): UserBrowserTool[] | null {
  const available = new Set(input.availableTools);
  if (!input.requested && !input.continuation) return null;
  return [...USER_BROWSER_TURN_TOOLS].filter((name) => available.has(name));
}
