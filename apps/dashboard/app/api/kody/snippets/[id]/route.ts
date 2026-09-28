/**
 * @fileType api-endpoint
 * @domain snippets
 * @pattern package-route-reexport
 * @ai-summary Snippet delete API — thin re-export of the package-owned
 *   handler (@kody-ade/kody-chat-dashboard).
 */
export { DELETE } from "@kody-ade/kody-chat-dashboard/routes/kody/snippets-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;
