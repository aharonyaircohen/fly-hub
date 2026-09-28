/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat-dashboard — this file only registers the route.
 */
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Snippets — Kody Operations Dashboard",
  description: "Scripts and HTML injected into brand pages.",
  path: "/snippets",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export { default } from "@kody-ade/kody-chat-dashboard/pages/snippets";
