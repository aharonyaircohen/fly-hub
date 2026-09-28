import { GET as cmsGET } from "@kody-ade/cms/routes/adapters";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function GET(...args: Parameters<typeof cmsGET>) {
  return withDashboardCmsRepoDocsStore(() => cmsGET(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/adapters.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
