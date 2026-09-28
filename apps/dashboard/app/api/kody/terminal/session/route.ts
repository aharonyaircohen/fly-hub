/** Brain owns terminal identity; Fly owns the authorized machine connection. */
export { POST } from "@kody-ade/brain/routes/terminal-session";
// The re-exported Brain route resolves host-owned personal services at runtime.
import "@dashboard/lib/brain/personal-services";

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/terminal/routes/terminal-session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
