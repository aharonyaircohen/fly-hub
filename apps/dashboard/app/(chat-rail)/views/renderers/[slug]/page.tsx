/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat-dashboard — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../../../metadata";

export const metadata = buildKodyMetadata({
  title: "View Renderer — Kody Operations Dashboard",
  description: "Manage one renderer JSON for structured chat UI.",
  path: "/views/renderers",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export { default } from "@kody-ade/kody-chat-dashboard/pages/view-renderer-detail";
