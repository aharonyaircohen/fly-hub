/**
 * @fileType page
 * @domain runner
 * @pattern fly-previews-page
 * @ai-summary Fly previews page: live preview URLs, machine details, PR
 * preview settings, cleanup, and manual branch previews.
 */
import { RunnerManager } from "@dashboard/features/admin/components/RunnerManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Previews — Kody Operations Dashboard",
  description: "View Fly preview URLs, machine details, and preview settings.",
  path: "/fly/previews",
});

export default function FlyPreviewsPage() {
  return <RunnerManager view="previews" />;
}
