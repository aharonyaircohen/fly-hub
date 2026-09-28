/**
 * @fileType data
 * @domain client-chat
 * @pattern client-language-config
 * @ai-summary Client-surface language packs. English ships built-in; other
 *   languages are operator-managed JSON files at `languages/<code>.json` in
 *   the backend. A brand's `locale` selects the language pack.
 */

export interface ClientLanguage {
  /** BCP-47-ish code, normalized lowercase (e.g. "en", "he", "fr-ca"). */
  code: string;
  /** Human-readable language name shown in the dashboard. */
  name: string;
  /** Flat catalog-key → text map (subset of CLIENT_LANGUAGE_STRING_KEYS). */
  strings: Record<string, string>;
}

export interface ClientLanguageResolveContext {
  owner: string;
  repo: string;
  token?: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

export const DEFAULT_CLIENT_LANGUAGE_CODE = "en";

/**
 * Every client-surface string a language pack may override. Keys are the
 * chat platform catalog keys; `{param}` placeholders are substituted by
 * `catalog.t`. Unknown keys in a language file are dropped on write.
 */
export const CLIENT_LANGUAGE_STRING_KEYS = [
  "chat.client.metaTitle",
  "chat.client.metaDescription",
  "chat.client.chatRegionLabel",
  "chat.client.dir",
  "chat.client.signOut",
  "chat.client.welcome",
] as const;

export type ClientLanguageStringKey =
  (typeof CLIENT_LANGUAGE_STRING_KEYS)[number];

/** Operator-facing labels for the editor UI, keyed by catalog key. */
export const CLIENT_LANGUAGE_STRING_LABELS: Record<
  ClientLanguageStringKey,
  string
> = {
  "chat.client.metaTitle": "Browser tab title ({brand} available)",
  "chat.client.metaDescription": "Meta description ({brand} available)",
  "chat.client.chatRegionLabel": "Chat region accessibility label",
  "chat.client.dir": 'Text direction: "rtl" or "ltr" (empty = auto by locale)',
  "chat.client.signOut": "Sign out button",
  "chat.client.welcome": "Welcome message (empty = chat default)",
};

/** Built-in English defaults. `chat.client.welcome` is intentionally empty:
 *  an empty value means "use the chat's default empty-state welcome". */
export const EN_CLIENT_LANGUAGE: ClientLanguage = {
  code: "en",
  name: "English",
  strings: {
    "chat.client.metaTitle": "{brand} Chat",
    "chat.client.metaDescription": "Chat with {brand}.",
    "chat.client.chatRegionLabel": "Kody chat",
    "chat.client.dir": "",
    "chat.client.signOut": "Sign out",
    "chat.client.welcome": "",
  },
};

const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

export function normalizeClientLanguageCode(input?: string): string {
  const normalized = (input ?? "").trim().toLowerCase().replace(/_/g, "-");
  return LANGUAGE_CODE_RE.test(normalized)
    ? normalized
    : DEFAULT_CLIENT_LANGUAGE_CODE;
}

export function isValidLanguageCode(code: string): boolean {
  return LANGUAGE_CODE_RE.test(code);
}

/** Keep only known catalog keys with string values (empty string is allowed —
 *  it means "suppress / use default"). */
export function pickKnownLanguageStrings(
  strings: Record<string, string>,
): Record<string, string> {
  const known = new Set<string>(CLIENT_LANGUAGE_STRING_KEYS);
  return Object.fromEntries(
    Object.entries(strings).filter(
      ([key, value]) => known.has(key) && typeof value === "string",
    ),
  );
}
