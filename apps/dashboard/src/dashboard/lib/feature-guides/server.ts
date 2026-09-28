/**
 * @fileType module
 * @domain features
 * @pattern markdown-feature-guide-provider
 * @ai-summary Reads strict guide.md files owned by Dashboard feature folders,
 *   validates their AI-facing sections, and resolves one guide from an
 *   explicit feature mention before falling back to the current page.
 */
import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoPathForNavMatching } from "@kody-ade/base/routes";
import type {
  FeatureGuide,
  FeatureGuideProvider,
  FeatureGuideTurn,
} from "@kody-ade/kody-chat-dashboard/platform/feature-guide-context";

export const REQUIRED_FEATURE_GUIDE_HEADINGS = [
  "What this feature does",
  "When to use it",
  "Available actions and options",
  "Requirements and permissions",
  "What will not work",
  "Known limitations",
  "Common failures and recovery",
  "Related tools and capabilities",
  "Authoritative sources",
] as const;

const SAFE_GUIDE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_FEATURE_GUIDE_IDS = [
  "admin",
  "agency",
  "engine-setup",
  "file-manager",
  "file-spaces",
  "inbox",
  "memory",
  "messages",
  "onboarding",
  "previews",
  "tasks",
  "vibe",
  "workflows",
] as const;

interface Frontmatter {
  id: string;
  title: string;
  summary: string;
  routes: string[];
  aliases: string[];
}

function parseList(lines: readonly string[], startIndex: number): string[] {
  const values: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (!match) break;
    values.push(match[1]!);
  }
  return values;
}

function parseFrontmatter(
  raw: string,
  path: string,
): {
  frontmatter: Frontmatter;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Feature guide ${path} is missing frontmatter`);
  const lines = match[1]!.split(/\r?\n/);
  const scalar = (key: string) =>
    lines
      .find((line) => line.startsWith(`${key}:`))
      ?.slice(key.length + 1)
      .trim() ?? "";
  const list = (key: string) => {
    const index = lines.findIndex((line) => line.trim() === `${key}:`);
    return index === -1 ? [] : parseList(lines, index);
  };
  const frontmatter: Frontmatter = {
    id: scalar("id"),
    title: scalar("title"),
    summary: scalar("summary"),
    routes: list("routes"),
    aliases: list("aliases"),
  };
  if (
    !SAFE_GUIDE_ID.test(frontmatter.id) ||
    !frontmatter.title ||
    !frontmatter.summary ||
    frontmatter.aliases.length === 0
  ) {
    throw new Error(`Feature guide ${path} has incomplete frontmatter`);
  }
  const body = match[2]!.trim();
  for (const heading of REQUIRED_FEATURE_GUIDE_HEADINGS) {
    if (!body.includes(`## ${heading}`)) {
      throw new Error(`Feature guide ${path} is missing "## ${heading}"`);
    }
  }
  return { frontmatter, body };
}

function aliasMatches(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

function currentPagePath(currentPage: string): string | null {
  const wrappedPath = currentPage.match(/\((\/[^)]+)\)/)?.[1];
  const rawPath = wrappedPath ?? currentPage.match(/(?:^|\s)(\/\S+)/)?.[1];
  if (!rawPath) return null;
  return repoPathForNavMatching(rawPath.split(/[?#]/, 1)[0]!);
}

function routeMatches(path: string, routePattern: string): boolean {
  const tokenized = routePattern
    .replace(/\*\*/g, "__GLOB__")
    .replace(/\[\.\.\.[^\]]+\]/g, "__REST__")
    .replace(/\[issueNumber\]/g, "__ISSUE_NUMBER__")
    .replace(/\[[^\]]+\]/g, "__SEGMENT__");
  const regex = tokenized
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/__GLOB__/g, ".*")
    .replace(/__REST__/g, ".+")
    .replace(/__ISSUE_NUMBER__/g, "\\d+")
    .replace(/__SEGMENT__/g, "[^/]+");
  return new RegExp(`^${regex}$`).test(path);
}

function routeSpecificity(routePattern: string): number {
  const dynamicParts = routePattern.match(/\*\*|\[[^\]]+\]/g)?.length ?? 0;
  const staticLength = routePattern.replace(/\*\*|\[[^\]]+\]/g, "").length;
  return staticLength * 10 - dynamicParts;
}

export function createFileFeatureGuideProvider(input: {
  rootDirectory: string;
  guideIds?: readonly string[];
}): FeatureGuideProvider {
  const guideIds = input.guideIds ?? DEFAULT_FEATURE_GUIDE_IDS;
  const allowedIds = new Set(guideIds);

  const read = async (id: string): Promise<FeatureGuide | null> => {
    if (!SAFE_GUIDE_ID.test(id) || !allowedIds.has(id)) return null;
    const path = join(input.rootDirectory, id, "guide.md");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const { frontmatter, body } = parseFrontmatter(raw, path);
    if (frontmatter.id !== id) {
      throw new Error(
        `Feature guide ${path} declares id "${frontmatter.id}" instead of "${id}"`,
      );
    }
    return { ...frontmatter, body };
  };

  const list = async (): Promise<readonly FeatureGuide[]> =>
    (await Promise.all(guideIds.map((id) => read(id)))).filter(
      (guide): guide is FeatureGuide => guide !== null,
    );

  const resolveForTurn = async (
    turn: FeatureGuideTurn,
  ): Promise<FeatureGuide | null> => {
    const guides = await list();
    const explicit = guides.find((guide) =>
      [guide.id, guide.title, ...guide.aliases].some((alias) =>
        aliasMatches(turn.userText, alias),
      ),
    );
    if (explicit) return explicit;
    const page = turn.currentPage?.trim();
    if (!page) return null;
    const path = currentPagePath(page);
    if (!path) return null;
    const matches = guides.flatMap((guide) =>
      guide.routes
        .filter((route) => routeMatches(path, route))
        .map((route) => ({ guide, score: routeSpecificity(route) })),
    );
    matches.sort((left, right) => right.score - left.score);
    return matches[0]?.guide ?? null;
  };

  return { list, read, resolveForTurn };
}
