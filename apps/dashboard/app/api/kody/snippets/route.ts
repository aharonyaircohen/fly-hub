/**
 * @fileType api-endpoint
 * @domain snippets
 * @pattern package-route-reexport
 * @ai-summary Snippets API — thin re-export of the package-owned handlers
 *   (@kody-ade/kody-chat-dashboard).
 */
export { GET, POST } from "@kody-ade/kody-chat-dashboard/routes/kody/snippets";

export const dynamic = "force-dynamic";
export const revalidate = 0;
