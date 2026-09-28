/**
 * @fileType page
 * @domain brain
 * @pattern brain-images-page
 *
 * Dedicated Brain image management page.
 */
import { BrainImagesManager } from "@dashboard/features/admin/components/BrainImagesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Brain Images — Kody Operations Dashboard",
  description: "Manage saved Brain runtime images.",
  path: "/fly/brain-images",
});

export default function BrainImagesPage() {
  return <BrainImagesManager />;
}
