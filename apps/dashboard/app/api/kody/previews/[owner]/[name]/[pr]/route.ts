/** Route re-export — implementation lives in @kody-ade/fly. */
export * from "@kody-ade/fly/routes/previews-pr-status";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/fly/routes/previews-pr-status.
export const runtime = "nodejs";
