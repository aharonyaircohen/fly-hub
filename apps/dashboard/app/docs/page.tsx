/**
 * @fileType page
 * @domain docs
 * @pattern docs-page
 * @ai-summary Docs entry point. Renders the connected repo's docs/ contents,
 *   with README.md available through a separate project document entry.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DocsView } from "@dashboard/lib/components/DocsView";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Docs — Kody Operations Dashboard",
  description: "Project documentation from the docs folder.",
  path: "/docs",
});

export default function DocsPage() {
  return (
    <AuthGuard>
      <DocsView />
    </AuthGuard>
  );
}
