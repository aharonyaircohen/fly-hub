/**
 * @fileType page
 * @domain runner
 * @pattern fly-machine-selected-page
 * @ai-summary Selected Fly machine route. Keeps machine selection addressable
 * at `/fly/machines/<app>/<machineId>`.
 */
import { RunnerManager } from "@dashboard/features/admin/components/RunnerManager";
import { buildKodyMetadata } from "../../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Machine — Kody Operations Dashboard",
  description: "View and manage a live Fly machine.",
  path: "/fly/machines",
});

export default async function SelectedFlyMachinePage({
  params,
}: {
  params: Promise<{ app: string; machineId: string }>;
}) {
  const { app, machineId } = await params;
  return (
    <RunnerManager
      view="machines"
      selectedApp={decodeURIComponent(app)}
      selectedMachineId={decodeURIComponent(machineId)}
    />
  );
}
