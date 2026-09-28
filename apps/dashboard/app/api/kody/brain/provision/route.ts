/** Route re-export — implementation lives in @kody-ade/brain. */
export * from "@kody-ade/brain/routes/provision";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/brain/routes/provision.
export const runtime = "nodejs";
export const maxDuration = 300;
import "@dashboard/lib/brain/personal-services";
