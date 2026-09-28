/**
 * @fileType api-endpoint
 * @domain user-state
 * @pattern package-route-reexport
 * @ai-summary Per-namespace user-state API — thin re-export of the
 *   package-owned handlers (@kody-ade/kody-chat-dashboard).
 */
export { GET, PUT } from "@kody-ade/kody-chat-dashboard/routes/kody/user-state-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
