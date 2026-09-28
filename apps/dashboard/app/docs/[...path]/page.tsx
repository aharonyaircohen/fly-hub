/**
 * @fileType page
 * @domain docs
 * @pattern docs-selected-page
 * @ai-summary Selected docs route. Keeps nested doc selection addressable at
 * `/docs/<path>`.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DocsView } from "@dashboard/lib/components/DocsView";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Docs — Kody Operations Dashboard",
  description: "View a selected project documentation file.",
  path: "/docs",
});

export default async function SelectedDocsPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return (
    <AuthGuard>
      <DocsView selectedPath={path.join("/")} />
    </AuthGuard>
  );
}
