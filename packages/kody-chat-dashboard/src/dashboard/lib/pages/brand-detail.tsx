/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Brand detail page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { BrandsManager } from "../components/BrandsManager";

export default async function SelectedBrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BrandsManager selectedSlug={slug} />;
}
