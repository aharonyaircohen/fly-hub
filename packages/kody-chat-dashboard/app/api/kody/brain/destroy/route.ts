/** Route re-export — implementation lives in @kody-ade/brain. */
export * from "@kody-ade/brain/routes/destroy";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/brain/routes/destroy.
export const runtime = "nodejs";
