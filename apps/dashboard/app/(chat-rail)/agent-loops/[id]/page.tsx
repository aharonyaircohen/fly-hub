import { AuthGuard } from "@dashboard/lib/auth-guard";
import { LoopsPage } from "@dashboard/features/agency/components/LoopsPage";
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Loop — Kody Operations Dashboard",
  description: "Inspect a recurring workflow or capability trigger.",
  path: "/agent-loops",
});

export default async function LoopDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AuthGuard>
      <LoopsPage selectedId={id} />
    </AuthGuard>
  );
}
