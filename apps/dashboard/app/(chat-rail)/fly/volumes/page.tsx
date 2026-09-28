/**
 * @fileType page
 * @domain infrastructure
 * @pattern fly-volumes-page
 * @ai-summary Fly persistent volume inventory and safe operations.
 */
import { FlyVolumesManager } from "@dashboard/features/admin/components/FlyVolumesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Volumes — Kody Operations Dashboard",
  description: "View and manage persistent Fly volumes.",
  path: "/fly/volumes",
});

export default function FlyVolumesPage() {
  return <FlyVolumesManager />;
}
