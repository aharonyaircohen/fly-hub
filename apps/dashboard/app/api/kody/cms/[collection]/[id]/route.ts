import {
  DELETE as cmsDELETE,
  GET as cmsGET,
  PATCH as cmsPATCH,
} from "@kody-ade/cms/routes/collection-id";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function GET(...args: Parameters<typeof cmsGET>) {
  return withDashboardCmsRepoDocsStore(() => cmsGET(...args));
}

export function PATCH(...args: Parameters<typeof cmsPATCH>) {
  return withDashboardCmsRepoDocsStore(() => cmsPATCH(...args));
}

export function DELETE(...args: Parameters<typeof cmsDELETE>) {
  return withDashboardCmsRepoDocsStore(() => cmsDELETE(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/collection-id.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
