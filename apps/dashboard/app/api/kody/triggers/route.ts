/**
 * @fileType api-endpoint
 * @domain triggers
 * @pattern package-route-reexport
 * @ai-summary Trigger rules API — thin re-export of the package-owned
 *   handlers (@kody-ade/kody-chat-dashboard).
 */
export { GET, POST } from "@kody-ade/kody-chat-dashboard/routes/kody/triggers";

// Next.js route-segment config can't be re-exported — declare it literally
// (mirrors the package route's own values).
export const dynamic = "force-dynamic";
export const revalidate = 0;
