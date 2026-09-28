import { ConnectionsManager } from "@dashboard/features/admin/components/ConnectionsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Connections — Kody Operations Dashboard",
  description: "Manage the external accounts Kody may use.",
  path: "/connections",
});

export default function ConnectionsPage() {
  return <ConnectionsManager />;
}
