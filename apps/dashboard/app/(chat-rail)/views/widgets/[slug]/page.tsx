/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared widget detail page from
 *   @kody-ade/kody-chat-dashboard.
 */
import { buildKodyMetadata } from "../../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Widget — Kody Operations Dashboard",
  description: "Inspect and run one published chat widget.",
  path: "/views/widgets",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export { default } from "@kody-ade/kody-chat-dashboard/pages/widget-detail";
