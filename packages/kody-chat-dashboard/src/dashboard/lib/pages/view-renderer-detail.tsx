/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical View Renderer detail page — hosts serve it as a
 *   one-line re-export (see pages-coverage specs in each host).
 */
import { ViewRenderersManager } from "../components/ViewRenderersManager";

export default async function ViewRendererDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ViewRenderersManager initialSlug={slug} />;
}
