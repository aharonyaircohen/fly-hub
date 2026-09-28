/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Create a new capability backed by backend capabilities storage.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilityEditorPage } from "@dashboard/features/admin/components/CapabilitiesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "New capability — Kody Operations Dashboard",
  description: "Create a reusable Kody capability.",
  path: "/capabilities/new",
});

export default function NewCapabilityPage() {
  return (
    <AuthGuard>
      <CapabilityEditorPage basePath="/capabilities" />
    </AuthGuard>
  );
}
