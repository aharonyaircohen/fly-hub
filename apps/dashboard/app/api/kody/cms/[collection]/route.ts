import {
  GET as cmsGET,
  POST as cmsPOST,
} from "@kody-ade/cms/routes/collection";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function GET(...args: Parameters<typeof cmsGET>) {
  return withDashboardCmsRepoDocsStore(() => cmsGET(...args));
}

export function POST(...args: Parameters<typeof cmsPOST>) {
  return withDashboardCmsRepoDocsStore(() => cmsPOST(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/collection.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
