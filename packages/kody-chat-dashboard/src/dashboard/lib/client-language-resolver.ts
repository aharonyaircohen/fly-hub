/**
 * @fileType utility
 * @domain client-chat
 * @pattern client-language-config
 * @ai-summary Server-side language pack resolver. Split out of
 *   client-language.ts so the client-safe module (types, constants, English
 *   defaults) never drags the GitHub client — and its `async_hooks` Node
 *   builtin — into client component bundles (dev-mode turbopack fails to
 *   compile /client pages otherwise). Server code (app/client page) imports
 *   this module; client components keep importing client-language.ts.
 */

import "server-only";

import {
  DEFAULT_CLIENT_LANGUAGE_CODE,
  EN_CLIENT_LANGUAGE,
  normalizeClientLanguageCode,
  type ClientLanguageResolveContext,
} from "./client-language";

/**
 * Resolve the merged string map for a locale: built-in English defaults,
 * overlaid with the repo's `languages/<code>.json` pack when one exists.
 * Mirrors `resolveClientBrand`'s context handling — public /client routes
 * may not carry a repo auth context, in which case English is served.
 */
export async function resolveClientLanguageStrings(
  locale: string,
  context?: ClientLanguageResolveContext | null,
): Promise<Record<string, string>> {
  const code = normalizeClientLanguageCode(locale);
  const base = { ...EN_CLIENT_LANGUAGE.strings };
  if (code === DEFAULT_CLIENT_LANGUAGE_CODE) return base;

  let clearContext: (() => void) | null = null;
  try {
    const { findLanguageFileFromList } = await import("./languages");
    if (context?.owner && context.repo) {
      const { clearGitHubContext, setGitHubContext } = await import(
        "./github-client"
      );
      setGitHubContext(
        context.owner,
        context.repo,
        context.token,
        context.storeRepoUrl,
        context.storeRef,
      );
      clearContext = clearGitHubContext;
    }
    const pack = await findLanguageFileFromList(code);
    if (pack) return { ...base, ...pack.strings };
  } catch {
    // Missing repo context or GitHub errors must never break the client
    // surface — fall back to English defaults.
  } finally {
    clearContext?.();
  }
  return base;
}
