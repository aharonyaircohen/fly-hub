import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesWorkspace } from "@dashboard/features/admin/components/CapabilitiesManager";
import { buildKodyMetadata } from "../../../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Capability files — Kody Operations Dashboard",
  description: "Browse and edit a capability folder.",
  path: "/capabilities",
});

export default async function CapabilityFilesPage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path = [] } = await params;
  return (
    <AuthGuard>
      <CapabilitiesWorkspace
        basePath="/capabilities"
        initialPath={
          path.length ? `${slug}/${path.join("/")}` : `${slug}/instructions.md`
        }
      />
    </AuthGuard>
  );
}
