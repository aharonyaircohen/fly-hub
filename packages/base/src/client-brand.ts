/**
 * @fileType data
 * @domain client-chat
 * @pattern client-brand-config
 * @ai-summary Small, route-owned brand config for the client chat surface.
 *   Brand-owned display data plus optional chat defaults enforced by the
 *   client surface host.
 */
import { slugifyTitle } from "@kody-ade/base/slug";
export type ClientBrandAccess = { mode: "public" } | { mode: "delegated" };

export interface ClientBrandAppearance {
  colorScheme: "light" | "dark";
  background: string;
  foreground: string;
  surface?: string;
  mutedForeground?: string;
  secondary?: string;
  border?: string;
  userMessage?: string;
  assistantMessage?: string;
  input?: string;
  fontSize?: "small" | "medium" | "large";
  radius?: "square" | "soft" | "rounded";
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

export function hasReadableClientBrandContrast(
  background: string,
  foreground: string,
): boolean {
  if (
    !/^#[0-9a-fA-F]{6}$/.test(background) ||
    !/^#[0-9a-fA-F]{6}$/.test(foreground)
  ) {
    return false;
  }
  const lighter = Math.max(
    relativeLuminance(background),
    relativeLuminance(foreground),
  );
  const darker = Math.min(
    relativeLuminance(background),
    relativeLuminance(foreground),
  );
  return (lighter + 0.05) / (darker + 0.05) >= 4.5;
}

/** Validate every client surface that renders the main or muted text color. */
export function hasReadableClientBrandAppearance(
  appearance: ClientBrandAppearance,
): boolean {
  const foregroundSurfaces = [
    appearance.background,
    appearance.surface,
    appearance.assistantMessage,
    appearance.input,
  ].filter((color): color is string => Boolean(color));
  if (
    !foregroundSurfaces.every((color) =>
      hasReadableClientBrandContrast(color, appearance.foreground),
    )
  ) {
    return false;
  }
  return appearance.mutedForeground
    ? hasReadableClientBrandContrast(
        appearance.background,
        appearance.mutedForeground,
      )
    : true;
}

export interface ClientBrand {
  slug: string;
  name: string;
  accent: string;
  appearance?: ClientBrandAppearance;
  /** BCP-47-ish locale tag, normalized lowercase (default "en"). Drives the
   *  surface-root text direction via `directionForLocale` (plan H7). */
  locale?: string;
  /** Optional brand welcome copy, contributed to the chat theme by the
   *  branding plugin (chat/plugins/branding). */
  welcomeText?: string;
  /** Optional user-managed LLM model id from the repo's LLM_MODELS config. */
  modelId?: string;
  /** Optional agency agent identity slug from `agents/<slug>.md`. */
  agentSlug?: string;
  /** How the client surface receives identity. Public is always explicit. */
  access: ClientBrandAccess;
}

export interface ClientBrandResolveContext {
  owner: string;
  repo: string;
  token?: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

const DEFAULT_CLIENT_LOCALE = "en";

const KNOWN_CLIENT_BRANDS: Record<string, ClientBrand> = {
  kody: {
    slug: "kody",
    name: "Kody",
    accent: "#0f766e",
    access: { mode: "public" },
  },
  // RTL reference brand (Step 5.5): same Kody surface, Hebrew locale.
  // Pinned by the RTL e2e in tests/e2e/client-chat-surface.spec.ts.
  "kody-he": {
    slug: "kody-he",
    name: "Kody",
    accent: "#0f766e",
    locale: "he",
    access: { mode: "public" },
  },
  // Theming reference brand (Step 6): distinct name + accent, pinned by the
  // branding-plugin e2e in tests/e2e/client-chat-surface.spec.ts.
  acme: {
    slug: "acme",
    name: "Acme",
    accent: "#7c3aed",
    access: { mode: "public" },
  },
};

export const BUILTIN_CLIENT_BRANDS: readonly ClientBrand[] = Object.values(
  KNOWN_CLIENT_BRANDS,
).map((brand) => ({
  ...brand,
  locale: normalizeClientBrandLocale(brand.locale),
}));

export function normalizeClientBrandLocale(input?: string): string {
  const normalized = (input ?? "").trim().toLowerCase().replace(/_/g, "-");
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(normalized)
    ? normalized
    : DEFAULT_CLIENT_LOCALE;
}

export function normalizeClientBrandSlug(input: string): string {
  return slugifyTitle(input, { allowUnderscore: false, fallback: "kody" });
}

/**
 * Normalize the persisted access contract. The legacy auth input is accepted
 * only while stored brand records are migrated; callers always receive the
 * new provider-agnostic model.
 */
export function normalizeClientBrandAccess(
  input: unknown,
  legacyAuth?: unknown,
): ClientBrandAccess {
  if (input && typeof input === "object") {
    const mode = (input as Record<string, unknown>).mode;
    if (mode === "delegated") return { mode: "delegated" };
    if (mode === "public") return { mode: "public" };
  }
  if (
    legacyAuth &&
    typeof legacyAuth === "object" &&
    (legacyAuth as Record<string, unknown>).required === true
  ) {
    return { mode: "delegated" };
  }
  return { mode: "public" };
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getClientBrand(slug: string): ClientBrand {
  const normalized = normalizeClientBrandSlug(slug);
  const base = KNOWN_CLIENT_BRANDS[normalized] ?? {
    slug: normalized,
    name: titleFromSlug(normalized),
    accent: "#0f766e",
    access: { mode: "public" } as const,
  };

  return { ...base, locale: normalizeClientBrandLocale(base.locale) };
}

export function getBuiltinClientBrand(slug: string): ClientBrand | null {
  const normalized = normalizeClientBrandSlug(slug);
  const brand = KNOWN_CLIENT_BRANDS[normalized];
  return brand
    ? { ...brand, locale: normalizeClientBrandLocale(brand.locale) }
    : null;
}
