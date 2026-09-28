import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesWorkspaceShell } from "@dashboard/features/admin/components/CapabilitiesWorkspaceShell";

export default function CapabilitiesWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <CapabilitiesWorkspaceShell />
      {children}
    </AuthGuard>
  );
}
