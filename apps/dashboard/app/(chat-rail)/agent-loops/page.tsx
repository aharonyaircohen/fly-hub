import { AuthGuard } from "@dashboard/lib/auth-guard";
import { LoopsPage } from "@dashboard/features/agency/components/LoopsPage";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Loops — Kody Operations Dashboard",
  description: "Simple recurring workflow and capability triggers.",
  path: "/agent-loops",
});

export default function LoopsRoute() {
  return (
    <AuthGuard>
      <LoopsPage />
    </AuthGuard>
  );
}
