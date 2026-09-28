/**
 * Pure markdown parsing and transport types for agent identity definitions.
 * Durable storage belongs to the backend definition repository.
 */

import { splitFrontmatter, type TickFrontmatter } from "./frontmatter";

export interface TickFile {
  slug: string;
  title: string;
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
  source?: "local" | "builtin" | "store";
  readOnly?: boolean;
  capabilities?: string[];
  subagents?: string[];
  /** Plain-language guidance used only to decide when to delegate here. */
  whenToUse?: string;
  primaryIntent?: string;
  /** Immutable default assignments supplied by product configuration. */
  lockedSubagents?: string[];
}

export interface TickWriteOptions {
  octokit: unknown;
  slug: string;
  title: string;
  body: string;
  sha?: string;
  message?: string;
  capabilities?: string[];
  subagents?: string[];
  whenToUse?: string;
  primaryIntent?: string;
}

function deriveTitle(body: string, slug: string): string {
  const firstLine = body.trimStart().split("\n", 1)[0] ?? "";
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (h1) return h1[1]!.trim();
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stripLeadingH1(body: string): string {
  const lines = body.replace(/^﻿/, "").split("\n");
  let index = 0;
  for (;;) {
    while (index < lines.length && lines[index]!.trim() === "") index += 1;
    if (index < lines.length && /^#\s+.+/.test(lines[index]!)) {
      index += 1;
    } else {
      break;
    }
  }
  return lines.slice(index).join("\n");
}

export function parseTickedMarkdown(
  raw: string,
  slug: string,
): { title: string; body: string; frontmatter: TickFrontmatter } {
  const { frontmatter, body: markdown } = splitFrontmatter(raw);
  return {
    title: deriveTitle(markdown, slug),
    body: stripLeadingH1(markdown),
    frontmatter,
  };
}
