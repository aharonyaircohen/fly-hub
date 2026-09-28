/**
 * @fileType component
 * @domain client-chat
 * @pattern route-shell
 * @ai-summary Public/client route shell: ChatSurface composition (Step 6).
 *   The brand becomes a branding plugin (theme capability); the surface
 *   registers ONLY branding + commands under a minimal grant, so the
 *   /client chunk never imports terminal/vibe plugin code (M6
 *   per-surface imports). Grants gate client-side composition only — not a
 *   security boundary (plan M6). KodyChat props stay the frozen trio
 *   (presentation / hideTerminalMode / railFullscreen).
 */
"use client";

import { useMemo } from "react";
import { Zap } from "lucide-react";

import type { ClientBrand } from "../client-brand";
import { directionForLocale } from "../chat/platform/i18n";
import type { ChatCapabilityGrant } from "../chat/platform";
import { createBrandingPlugin } from "../chat/plugins/branding";
import { commandsChatPlugin } from "../chat/plugins/commands";
import { getClientSurfaceCatalog } from "../client-chat-strings";
import { brandThemeStyle } from "../brand-theme";
import { KodyChat } from "./KodyChat";

// Minimal grant for the client surface: "theme" for the branding plugin,
// "middleware" + "host-effects" for the commands plugin (slash expansion ran
// on every surface pre-platform, so /client keeps it). Nothing else — no
// slots, agents, display modes, or session state.
const CLIENT_CHAT_GRANT: ChatCapabilityGrant = [
  "theme",
  "middleware",
  "host-effects",
];

const SURFACE_TICKET_HEADER = "x-kody-surface-ticket";

export interface ClientSurfaceUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export function ClientChatSurface({
  brand,
  surfaceTicket,
  user,
  signOutAction,
  languageStrings,
}: {
  brand: ClientBrand;
  surfaceTicket?: string;
  /** Signed-in client user (auth-gated brands only). */
  user?: ClientSurfaceUser;
  /** Server action that ends the session and returns to the brand page. */
  signOutAction?: () => Promise<void>;
  /** Resolved language pack for the brand's locale (languages/<code>.json). */
  languageStrings?: Record<string, string>;
}) {
  // The branding plugin is the single source for what this shell displays:
  // the header reads the SAME theme contribution the registry merges via
  // `registry.theme()` inside the KodyChat mount.
  const brandingPlugin = useMemo(() => createBrandingPlugin(brand), [brand]);
  const plugins = useMemo(
    () => [{ plugin: brandingPlugin }, { plugin: commandsChatPlugin }],
    [brandingPlugin],
  );
  const kodyDirectHeaders = useMemo(
    () =>
      surfaceTicket ? { [SURFACE_TICKET_HEADER]: surfaceTicket } : undefined,
    [surfaceTicket],
  );
  const theme = brandingPlugin.theme ?? {};
  const locale = theme.locale ?? "en";
  const catalog = getClientSurfaceCatalog(locale, languageStrings);
  // Language pack welcome wins over the brand's welcomeText; empty means
  // "use the chat's default empty state".
  const welcomeText =
    catalog.t("chat.client.welcome") || theme.welcomeText || "";
  const packDir = catalog.t("chat.client.dir");
  const dir =
    packDir === "rtl" || packDir === "ltr"
      ? packDir
      : directionForLocale(locale);

  return (
    <main
      data-testid="client-chat-surface"
      data-theme={theme.colorScheme}
      // Surface-root direction only — per-message bubbles keep their own
      // explicit `dir` (getMessageDirection in chat/surface/MessageList.tsx).
      dir={dir}
      style={brandThemeStyle(theme)}
      className="flex h-dvh min-h-dvh flex-col bg-background text-foreground"
    >
      <header className="shrink-0 border-b border-border bg-card px-4 py-3 text-card-foreground">
        <div className="flex w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              data-testid="client-brand-accent"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary-foreground shadow-sm"
              style={{ backgroundColor: theme.accent }}
              aria-hidden="true"
            >
              <Zap className="h-4 w-4" />
            </span>
            <span
              data-testid="client-brand-name"
              className="truncate text-base font-semibold"
            >
              {theme.name}
            </span>
          </div>
          {user && (
            <div
              data-testid="client-user-menu"
              className="flex min-w-0 items-center gap-2"
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- external avatar host
                <img
                  src={user.image}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:block">
                {user.name || user.email}
              </span>
              {signOutAction && (
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {catalog.t("chat.client.signOut")}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </header>

      <div
        aria-label={catalog.t("chat.client.chatRegionLabel")}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        <KodyChat
          emptyStateWelcome={
            // No pack string and no brand welcomeText -> plain assistant
            // greeting (never the dashboard's coding welcome).
            welcomeText || <p className="font-medium">Hi! How can I help?</p>
          }
          presentation="standalone"
          hideTerminalMode
          hideAgentPicker
          compactHeader
          allowSessionSidebarPin={false}
          autoOpenSessionSidebar={false}
          lockedModelId={brand.modelId}
          lockedAgentSlug={brand.agentSlug}
          allowAgencyAgentSelection={false}
          kodyDirectHeaders={kodyDirectHeaders}
          messageRoleLayout="client"
          railFullscreen
          plugins={plugins}
          capabilityGrant={CLIENT_CHAT_GRANT}
        />
      </div>
    </main>
  );
}
