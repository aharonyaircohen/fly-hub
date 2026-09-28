import { POST as cmsPOST } from "@kody-ade/cms/routes/schema";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function POST(...args: Parameters<typeof cmsPOST>) {
  return withDashboardCmsRepoDocsStore(() => cmsPOST(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/schema.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
