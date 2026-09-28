/** @pattern package-page-reexport */
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Brain — Kody Operations Dashboard",
  description: "Manage your personal Brain chat models and runtimes.",
  path: "/brain",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

import BrainPage from "@kody-ade/kody-chat-dashboard/pages/brain";
import { BrainFlyCard } from "@dashboard/features/admin/components/BrainFlyCard";

export default function PersonalBrainPage() {
  return (
    <div className="space-y-6">
      <BrainFlyCard headers={{}} />
      <BrainPage />
    </div>
  );
}
