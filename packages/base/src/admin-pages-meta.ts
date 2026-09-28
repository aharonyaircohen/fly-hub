/**
 * @fileType module
 * @domain chat-platform
 * @pattern admin-page-registry
 * @ai-summary Server-safe metadata for package-owned admin pages (hrefs,
 *   labels, icons, tints, aliases). Safe to import from server modules —
 *   NO plugin imports here: plugins call client-only createLazyPanel at
 *   module scope. Client consumers that need the plugin/panel pair import
 *   ./admin-pages instead.
 */
import { Languages, Palette, type LucideIcon } from "lucide-react";

export interface PackageAdminPageMeta {
  /** Route prefix the host mounts the page under (also the nav href). */
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind tint classes for the host sidebar chip. */
  tint: string;
  panelId: string;
  /** Phrases the host's assistant-navigation layer matches on. */
  aliases: string[];
  when: string;
}

export const PACKAGE_ADMIN_PAGE_META: readonly PackageAdminPageMeta[] = [
  {
    href: "/themes",
    label: "Client Themes",
    description: "Complete client chat appearance for each brand.",
    icon: Palette,
    tint: "text-fuchsia-300 bg-fuchsia-500/10",
    panelId: "themes",
    aliases: ["themes", "brand themes", "appearance", "brand colors"],
    when: "Use when the user asks to manage client chat themes or brand colors.",
  },
  {
    href: "/languages",
    label: "Languages",
    description: "Client chat translations for /client surfaces.",
    icon: Languages,
    tint: "text-amber-300 bg-amber-500/10",
    panelId: "languages",
    aliases: ["languages", "translations", "locales"],
    when: "Use when the user asks to manage client chat languages or translations.",
  },
];
