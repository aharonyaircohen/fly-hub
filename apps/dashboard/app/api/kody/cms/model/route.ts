import {
  DELETE as cmsDELETE,
  PATCH as cmsPATCH,
} from "@kody-ade/cms/routes/model";
import { withDashboardCmsRepoDocsStore } from "@kody-ade/kody-chat-dashboard/cms-backend-store";

export function PATCH(...args: Parameters<typeof cmsPATCH>) {
  return withDashboardCmsRepoDocsStore(() => cmsPATCH(...args));
}

export function DELETE(...args: Parameters<typeof cmsDELETE>) {
  return withDashboardCmsRepoDocsStore(() => cmsDELETE(...args));
}

// Next.js segment config must be declared literally in the app route file —
// re-exported consts are ignored by Next.js static analysis. Mirrors @kody-ade/cms/routes/model.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
