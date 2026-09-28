/** Route re-export — implementation lives in @kody-ade/agency. */
export * from "@kody-ade/agency/routes/agents";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/agency/routes/agents.
export const dynamic = "force-dynamic";
export const revalidate = 0;
