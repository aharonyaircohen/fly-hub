/** Route re-export — implementation lives in @kody-ade/terminal. */
export * from "@kody-ade/terminal/routes/chat-terminal-input";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/terminal/routes/chat-terminal-input.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
