/**
 * @fileType module
 * @domain client-chat
 * @pattern languages-index
 * @ai-summary Public surface for operator-managed client languages. Repo
 *   packs at `languages/<code>.json` overlay the built-in English strings;
 *   English itself is always present as the built-in default.
 */

import { EN_CLIENT_LANGUAGE, type ClientLanguage } from "../client-language";
import { listLanguageFiles, type LanguageFile } from "./files";

export type { LanguageFile, WriteLanguageOptions } from "./files";
export {
  deleteLanguageFile,
  findLanguageFileFromList,
  listLanguageFiles,
  readLanguageFile,
  writeLanguageFile,
} from "./files";

export type LanguageSource = "repo" | "builtin";

export type ResolvedLanguage = ClientLanguage & {
  source: LanguageSource;
  sha: string;
  htmlUrl: string;
};

export async function listLanguages(): Promise<ResolvedLanguage[]> {
  const repoLanguages = await listLanguageFiles();
  const hasEnOverride = repoLanguages.some(
    (language) => language.code === EN_CLIENT_LANGUAGE.code,
  );
  const builtins: ResolvedLanguage[] = hasEnOverride
    ? []
    : [{ ...EN_CLIENT_LANGUAGE, source: "builtin", sha: "", htmlUrl: "" }];
  return [...repoLanguages, ...builtins].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

export function isRepoLanguage(
  language: ResolvedLanguage | LanguageFile,
): language is LanguageFile {
  return language.source === "repo";
}
