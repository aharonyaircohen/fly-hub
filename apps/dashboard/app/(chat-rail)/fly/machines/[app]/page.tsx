/**
 * @fileType page
 * @domain runner
 * @pattern fly-app-machines-page
 * @ai-summary Fly machines filtered to one provider app.
 */
import { RunnerManager } from "@dashboard/features/admin/components/RunnerManager";
import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "App Machines — Kody Operations Dashboard",
  description: "View and manage machines for one Fly app.",
  path: "/fly/machines",
});

export default async function FlyAppMachinesPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;
  return (
    <RunnerManager view="machines" selectedApp={decodeURIComponent(app)} />
  );
}
