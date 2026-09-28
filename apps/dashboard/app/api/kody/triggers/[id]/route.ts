/**
 * @fileType api-endpoint
 * @domain triggers
 * @pattern package-route-reexport
 * @ai-summary Trigger delete API — thin re-export of the package-owned
 *   handler (@kody-ade/kody-chat-dashboard).
 */
export { DELETE } from "@kody-ade/kody-chat-dashboard/routes/kody/triggers-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;
