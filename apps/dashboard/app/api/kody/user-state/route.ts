/**
 * @fileType api-endpoint
 * @domain user-state
 * @pattern package-route-reexport
 * @ai-summary User-state namespaces API — thin re-export of the
 *   package-owned handler (@kody-ade/kody-chat-dashboard).
 */
export { GET } from "@kody-ade/kody-chat-dashboard/routes/kody/user-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
