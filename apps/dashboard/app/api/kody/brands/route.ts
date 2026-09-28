/** Route re-export — implementation lives in @kody-ade/workspace. */
export * from "@kody-ade/workspace/routes/brands";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/workspace/routes/brands.
export const dynamic = "force-dynamic";
export const revalidate = 0;
