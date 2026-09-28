import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesWorkspace } from "@dashboard/features/admin/components/CapabilitiesManager";
import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Edit capability — Kody Operations Dashboard",
  description: "Edit a capability folder.",
  path: "/capabilities",
});

export default async function EditCapabilityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <CapabilitiesWorkspace
        basePath="/capabilities"
        initialPath={`${slug}/instructions.md`}
      />
    </AuthGuard>
  );
}
