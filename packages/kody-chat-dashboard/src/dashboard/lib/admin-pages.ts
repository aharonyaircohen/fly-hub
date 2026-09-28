/**
 * @fileType module
 * @domain chat-platform
 * @pattern admin-page-registry
 * @ai-summary Registry of package-owned admin pages WITH their page-plugins.
 *   CLIENT-ONLY: plugin manifests call createLazyPanel at module scope, so
 *   importing this from a server module crashes the app — server code must
 *   use ./admin-pages-meta instead. A host consumes this once (rail plugin
 *   list + panel map) so shipping a new package page needs no per-feature
 *   host glue — only a tarball refresh.
 */
import type { ChatPlugin } from "./chat/platform";
import {
  languagesChatPlugin,
  LANGUAGES_PANEL_ID,
} from "./chat/plugins/languages";
import { themesChatPlugin, THEMES_PANEL_ID } from "./chat/plugins/themes";
import {
  PACKAGE_ADMIN_PAGE_META,
  type PackageAdminPageMeta,
} from "@kody-ade/base/admin-pages-meta";

export type PackageAdminPage = PackageAdminPageMeta & {
  /** Page-plugin contributing the rail panel. */
  plugin: ChatPlugin;
};

const PLUGIN_FOR_PANEL: Record<string, ChatPlugin> = {
  [THEMES_PANEL_ID]: themesChatPlugin,
  [LANGUAGES_PANEL_ID]: languagesChatPlugin,
};

export const PACKAGE_ADMIN_PAGES: readonly PackageAdminPage[] =
  PACKAGE_ADMIN_PAGE_META.map((meta) => ({
    ...meta,
    plugin: PLUGIN_FOR_PANEL[meta.panelId],
  }));

export { PACKAGE_ADMIN_PAGE_META } from "@kody-ade/base/admin-pages-meta";
export type { PackageAdminPageMeta } from "@kody-ade/base/admin-pages-meta";
