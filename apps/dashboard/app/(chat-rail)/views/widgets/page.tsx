/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat-dashboard — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Widgets — Kody Operations Dashboard",
  description: "Publish per-tenant widget bundles for chat surfaces.",
  path: "/views/widgets",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export { default } from "@kody-ade/kody-chat-dashboard/pages/widgets";
