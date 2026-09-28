import {
  GET as cmsGET,
  PATCH as cmsPATCH,
  POST as cmsPOST,
} from "@kody-ade/cms/routes/index";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function GET(...args: Parameters<typeof cmsGET>) {
  return withDashboardCmsRepoDocsStore(() => cmsGET(...args));
}

export function POST(...args: Parameters<typeof cmsPOST>) {
  return withDashboardCmsRepoDocsStore(() => cmsPOST(...args));
}

export function PATCH(...args: Parameters<typeof cmsPATCH>) {
  return withDashboardCmsRepoDocsStore(() => cmsPATCH(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/index.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
