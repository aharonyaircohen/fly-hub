/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Selected capability route backed by backend capabilities storage.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesWorkspace } from "@dashboard/features/admin/components/CapabilitiesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Capability — Kody Operations Dashboard",
  description: "View a selected Kody capability.",
  path: "/capabilities",
});

export default async function CapabilityPage({
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
