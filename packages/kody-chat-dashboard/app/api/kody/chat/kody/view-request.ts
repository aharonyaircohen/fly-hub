/**
 * @fileType utility
 * @domain kody
 * @pattern prompt-intent-parser
 * @ai-summary Parses direct "show <purpose> UI" requests so Kody chat can
 *   force the show_view tool instead of letting the model answer in prose.
 */

import { slugifyTitle } from "@kody-ade/base/slug";

export interface ExplicitViewRequest {
  purpose: string;
  title?: string;
}

function normalizePurpose(raw: string): string {
  return slugifyTitle(raw);
}

function cleanTitle(raw: string | undefined): string | undefined {
  const title = raw
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  return title && title.length > 0 ? title : undefined;
}

export function parseExplicitViewRequest(
  text: string | null | undefined,
): ExplicitViewRequest | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const match =
    /^show\s+([a-z0-9][a-z0-9_\-\s]{0,80}?)\s+ui\s*:?\s*(.*)$/is.exec(trimmed);
  if (match) {
    const purpose = normalizePurpose(match[1]);
    if (!purpose) return null;
    const title = cleanTitle(match[2]);
    return {
      purpose,
      ...(title ? { title } : {}),
    };
  }

  if (
    !/^(?:please\s+)?render\b/i.test(trimmed) ||
    !/\b(?:card|ui|view)\b/i.test(trimmed)
  ) {
    return null;
  }
  const title = cleanTitle(
    /\btitled\s+(.+?)(?=\s+with\b|[.!?\n]|$)/i.exec(trimmed)?.[1],
  );
  return {
    purpose: normalizePurpose(title ?? "custom-view"),
    ...(title ? { title } : {}),
  };
}

export function buildExplicitViewRequestInstruction(
  request: ExplicitViewRequest,
): string {
  return [
    "The latest user message is an explicit UI render request.",
    "Your next action must be a show_view tool call.",
    `Render the view named "${request.purpose}": use the matching view component from the show_view catalog as the spec root, or compose it from atoms if no component matches.`,
    ...(request.title
      ? [`Use the title: ${JSON.stringify(request.title)}.`]
      : []),
    "Do not answer in prose before the tool call.",
  ].join("\n");
}
