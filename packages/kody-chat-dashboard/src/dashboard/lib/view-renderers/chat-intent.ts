/**
 * @fileType util
 * @domain view-renderers
 * @pattern renderer-intent-routing
 * @ai-summary Decides when a chat turn should end with a user-managed renderer.
 */
import type { ViewRendererDefinition } from "./standalone-renderer-store";

const RENDERER_INTENT_STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "as",
  "available",
  "data",
  "from",
  "in",
  "is",
  "it",
  "item",
  "keys",
  "kody",
  "list",
  "me",
  "one",
  "optional",
  "purpose",
  "the",
  "to",
  "use",
  "user",
  "when",
]);

function tokenStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 2 || RENDERER_INTENT_STOP_WORDS.has(raw)) continue;
    stems.add(raw);
    if (raw.endsWith("ies") && raw.length > 4) {
      stems.add(`${raw.slice(0, -3)}y`);
    }
    if (raw.endsWith("ion") && raw.length > 5) {
      stems.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ing") && raw.length > 5) {
      stems.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ed") && raw.length > 4) {
      stems.add(raw.slice(0, -2));
    }
    if (raw.endsWith("s") && raw.length > 3) {
      stems.add(raw.slice(0, -1));
    }
  }
  return stems;
}

function rendererIntentText(definition: ViewRendererDefinition): string {
  return [
    definition.slug,
    definition.name,
    definition.description,
    definition.purpose,
    ...(definition.aliases ?? []),
    definition.rule,
    ...uiNodeText(definition.ui),
    ...Object.entries(definition.data ?? {}).flatMap(([key, field]) => [
      key,
      field.type,
      field.description,
    ]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function uiNodeText(node: ViewRendererDefinition["ui"]): string[] {
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    return [
      node.type,
      node.for,
      node.as,
      ...(node.children ?? []).flatMap(uiNodeText),
      ...(node.item ? uiNodeText(node.item) : []),
    ].filter((value): value is string => typeof value === "string");
  }
  return Object.values(node).filter(
    (value): value is string => typeof value === "string",
  );
}

function isDirectAgentAsk(text: string): boolean {
  const match =
    /\bask\s+([^.!?\n]{0,80}?)\b(?:agent|subagent|specialist)\b/i.exec(text);
  return Boolean(match && !/\b(?:me|user)\b/i.test(match[1] ?? ""));
}

function isInformationalRequest(text: string): boolean {
  return /^\s*(?:explain|describe|summarize|what|why|how|should|(?:can|could)\s+we)\b/i.test(
    text,
  );
}

function isLinkOrPathRequest(text: string): boolean {
  return /^\s*(?:please\s+)?(?:provide|give|find|get|open|share|send|show)\b[^?\n]{0,120}\b(?:link|url|path|route|page)\b/i.test(
    text,
  );
}

function isNonInteractiveOperation(text: string): boolean {
  if (
    !/^\s*(?:read|rewrite|publish|update|delete|remove|rename|move|copy|archive)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return !/\b(?:ask\s+(?:me|the\s+user)|allow\s+(?:me|the\s+user)|let\s+(?:me|the\s+user)|choose|select|approve|confirm|fill\s+(?:in|out)|enter)\b/i.test(
    text,
  );
}

function requestsInteractiveResponse(text: string): boolean {
  return (
    /\b(?:ask|aske|allow|let)\s+(?:me|the\s+user|user)\b/i.test(text) ||
    /\b(?:choose|select|approve|confirm|fill\s+(?:in|out)|enter)\b/i.test(
      text,
    ) ||
    /^\s*(?:(?:can|could|would)\s+(?:you|u)\s+|please\s+)?(?:create|prepare|add)\b/i.test(
      text,
    )
  );
}

function requestsPlainTextOnly(text: string): boolean {
  return (
    /\bplain[- ]text\b/i.test(text) ||
    /\breply\b[^.!?\n]{0,120}\bonly\b/i.test(text) ||
    /\b(?:take|perform) no action\b/i.test(text)
  );
}

/** Data-shaped requests should render; narrative reasoning should stay text. */
export function shouldRequireStructuredViewForTurn(
  userText: string | null | undefined,
): boolean {
  const text = userText?.trim() ?? "";
  if (!text || /<view_result>[\s\S]*<\/view_result>/i.test(text)) return false;
  if (
    /^(?:(?:show|tell) me\s+)?(?:explain|describe|summarize|analyze|review|investigate|diagnose|recommend|advise|why|how)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /^(?:please\s+)?(?:list|show|display|browse)\b/i.test(text) ||
    /^(?:what|which)\b[^?\n]{0,160}\b(?:available|exist)\b/i.test(text)
  );
}

export function shouldRequireViewOutputForTurn({
  userText,
  definitions,
}: {
  userText: string | null | undefined;
  definitions: readonly ViewRendererDefinition[];
}): boolean {
  const text = userText ?? "";
  if (/<view_result>[\s\S]*<\/view_result>/i.test(text)) return false;
  if (isLinkOrPathRequest(text)) return false;
  // "Ask the Repository Specialist to ..." is an instruction to execute an
  // assigned Agent, not a request for Kody to ask the user for approval.
  if (isDirectAgentAsk(text)) return false;
  if (isInformationalRequest(text)) return false;
  if (isNonInteractiveOperation(text)) return false;
  if (requestsPlainTextOnly(text)) return false;
  if (!requestsInteractiveResponse(text)) return false;
  const userStems = tokenStems(text);
  if (userStems.size === 0 || definitions.length === 0) return false;
  const rendererStems = tokenStems(
    definitions.map(rendererIntentText).join(" "),
  );
  for (const stem of userStems) {
    if (rendererStems.has(stem)) return true;
  }
  return false;
}

function isReadLikeToolName(toolName: string): boolean {
  return /^(list|read|get|search|fetch|describe)_/.test(toolName);
}

export function shouldAllowPreRenderToolCallsForTurn({
  userText,
  toolNames,
}: {
  userText: string | null | undefined;
  toolNames: Iterable<string>;
}): boolean {
  const userStems = tokenStems(userText ?? "");
  if (userStems.size === 0) return false;
  for (const toolName of toolNames) {
    if (!isReadLikeToolName(toolName)) continue;
    const toolStems = tokenStems(toolName.replace(/_/g, " "));
    for (const stem of userStems) {
      if (toolStems.has(stem)) return true;
    }
  }
  return false;
}
