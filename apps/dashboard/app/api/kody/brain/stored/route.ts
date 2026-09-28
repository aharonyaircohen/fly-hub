/** Route re-export — implementation lives in @kody-ade/brain. */
export * from "@kody-ade/brain/routes/stored";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/brain/routes/stored.
export const runtime = "nodejs";
import "@dashboard/lib/brain/personal-services";
