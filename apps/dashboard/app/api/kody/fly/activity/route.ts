/** Route re-export — implementation lives in @kody-ade/fly. */
export { GET } from "@kody-ade/fly/hub/activity";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/fly/routes/fly-activity.
export const runtime = "nodejs";
