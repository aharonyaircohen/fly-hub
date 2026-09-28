/** Route re-export — implementation lives in @kody-ade/workspace. */
import "@dashboard/lib/chat/personal-model-settings";

export * from "@kody-ade/workspace/routes/memory";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/workspace/routes/memory.
export const dynamic = "force-dynamic";
export const revalidate = 0;
