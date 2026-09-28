/**
 * @fileType util
 * @domain client-chat
 * @pattern languages-files
 * @ai-summary Read/write operator-managed client language JSON files under
 *   `languages/<code>.json` in the resolved Kody backend. Packs override
 *   the built-in English strings on the /client chat surface; a brand's
 *   `locale` selects the pack.
 */

import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { getOwner, getRepo } from "../github-client";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  isValidLanguageCode,
  normalizeClientLanguageCode,
  pickKnownLanguageStrings,
  type ClientLanguage,
} from "../client-language";

export interface LanguageFile extends ClientLanguage {
  source: "repo";
  sha: string;
  htmlUrl: string;
}

const LANGUAGES_DIR = "languages";
const LANGUAGE_CACHE_TTL_MS = 60_000;

const languageFileSchema = z.object({
  code: z.string().trim().min(2).max(35),
  name: z.string().trim().min(1).max(80),
  strings: z.record(z.string(), z.string().max(2000)).default({}),
});

type LanguageFileInput = z.infer<typeof languageFileSchema>;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheEntry<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key);
  return entry ? (entry as CacheEntry<T>) : null;
}

function cacheGet<T>(key: string): T | undefined {
  const entry = cacheEntry<T>(key);
  if (!entry || entry.expires <= Date.now()) return undefined;
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, etag?: string): void {
  cache.set(key, {
    data,
    expires: Date.now() + LANGUAGE_CACHE_TTL_MS,
    etag,
  });
}

function invalidateLocalLanguageCache(code?: string): void {
  if (code) {
    cache.delete(`language:${getOwner()}:${getRepo()}:${code}`);
  }
  cache.delete(`languages:${getOwner()}:${getRepo()}`);
}

function codeFromName(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const code = name.slice(0, -".json".length);
  return isValidLanguageCode(code) ? code : null;
}

function normalizeLanguageInput(
  input: LanguageFileInput,
  fallbackCode?: string,
): ClientLanguage {
  const code = normalizeClientLanguageCode(input.code || fallbackCode || "");
  if (!isValidLanguageCode(code)) {
    throw new Error(
      'Language code must be a BCP-47-style tag like "he" or "fr-ca".',
    );
  }
  return {
    code,
    name: input.name.trim(),
    strings: pickKnownLanguageStrings(input.strings),
  };
}

function parseLanguageJson(raw: string, fallbackCode: string): ClientLanguage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid language file "${fallbackCode}": JSON is malformed`,
    );
  }
  const result = languageFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid language file "${fallbackCode}": ${result.error.issues[0]?.message ?? "validation failed"}`,
    );
  }
  return normalizeLanguageInput(result.data, fallbackCode);
}

function languageFilePath(code: string): string {
  return `${LANGUAGES_DIR}/${code}.json`;
}

export async function listLanguageFiles(): Promise<LanguageFile[]> {
  const cacheKey = `languages:${getOwner()}:${getRepo()}`;
  const cached = cacheGet<LanguageFile[]>(cacheKey);
  if (cached !== undefined) return cached;

  const stale = cacheEntry<LanguageFile[]>(cacheKey);
  try {
    const rows = (await createBackendClient().query(api.repoDocs.listByPrefix, {
      tenantId: `${getOwner()}/${getRepo()}`,
      prefix: `${LANGUAGES_DIR}/`,
    })) as Array<{ kind: string; doc: unknown; updatedAt?: string }>;
    const languages = rows
      .map((row) => {
        const code = codeFromName(row.kind.slice(`${LANGUAGES_DIR}/`.length));
        if (!code) return null;
        const language = parseLanguageJson(JSON.stringify(row.doc), code);
        return {
          ...language,
          source: "repo" as const,
          sha: row.updatedAt ?? "convex",
          htmlUrl: "",
        };
      })
      .filter((file): file is LanguageFile => file !== null)
      .sort((a, b) => a.code.localeCompare(b.code));
    cacheSet(cacheKey, languages);
    return languages;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      cacheSet(cacheKey, []);
      return [];
    }
    throw error;
  }
}

export async function readLanguageFile(
  code: string,
  octokitOverride?: Octokit,
): Promise<LanguageFile | null> {
  const normalized = normalizeClientLanguageCode(code);
  if (!isValidLanguageCode(normalized)) return null;
  const cacheKey = `language:${getOwner()}:${getRepo()}:${normalized}`;
  const cached = cacheGet<LanguageFile | null>(cacheKey);
  if (cached !== undefined) return cached;

  void octokitOverride;
  const stale = cacheEntry<LanguageFile | null>(cacheKey);
  try {
    const row = (await createBackendClient().query(api.repoDocs.get, {
      tenantId: `${getOwner()}/${getRepo()}`,
      kind: languageFilePath(normalized),
    })) as { doc?: unknown; updatedAt?: string } | null;
    if (!row) {
      cacheSet(cacheKey, null);
      return null;
    }
    const language = parseLanguageJson(JSON.stringify(row.doc), normalized);
    const resolved = {
      ...language,
      source: "repo" as const,
      sha: row.updatedAt ?? "convex",
      htmlUrl: "",
    };
    cacheSet(cacheKey, resolved);
    return resolved;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      cacheSet(cacheKey, null);
      return null;
    }
    throw error;
  }
}

export async function findLanguageFileFromList(
  code: string,
): Promise<LanguageFile | null> {
  const normalized = normalizeClientLanguageCode(code);
  if (!isValidLanguageCode(normalized)) return null;
  const languages = await listLanguageFiles();
  return languages.find((language) => language.code === normalized) ?? null;
}

export interface WriteLanguageOptions {
  octokit: Octokit;
  code: string;
  name: string;
  strings: Record<string, string>;
  sha?: string;
  message?: string;
}

export async function writeLanguageFile(
  opts: WriteLanguageOptions,
): Promise<LanguageFile> {
  const language = normalizeLanguageInput({
    code: opts.code,
    name: opts.name,
    strings: opts.strings,
  });
  void opts.octokit;
  void opts.sha;
  void opts.message;
  await createBackendClient().mutation(api.repoDocs.save, {
    tenantId: `${getOwner()}/${getRepo()}`,
    kind: languageFilePath(language.code),
    doc: language,
    updatedAt: new Date().toISOString(),
  });

  invalidateLocalLanguageCache(language.code);
  const refreshed = await readLanguageFile(language.code, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeLanguageFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteLanguageFile(
  octokit: Octokit,
  code: string,
): Promise<void> {
  const existing = await readLanguageFile(code, octokit);
  if (!existing) return;
  await createBackendClient().mutation(api.repoDocs.remove, {
    tenantId: `${getOwner()}/${getRepo()}`,
    kind: languageFilePath(existing.code),
  });
  invalidateLocalLanguageCache(existing.code);
}
