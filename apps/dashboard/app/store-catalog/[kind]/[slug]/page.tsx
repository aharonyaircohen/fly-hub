/**
 * @fileType page
 * @domain kody
 * @pattern store-catalog-selected-page
 * @ai-summary Selected Store Catalog item route. Uses kind plus slug because
 * catalog slugs are only unique inside their item kind.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { StoreCatalogManager } from "@dashboard/features/admin/components/StoreCatalogManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Store Catalog Item - Kody Operations Dashboard",
  description: "View a selected shared Kody store item.",
  path: "/store-catalog",
});

export default async function SelectedStoreCatalogItemPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  return (
    <AuthGuard>
      <StoreCatalogManager selectedKey={`${kind}:${slug}`} />
    </AuthGuard>
  );
}
