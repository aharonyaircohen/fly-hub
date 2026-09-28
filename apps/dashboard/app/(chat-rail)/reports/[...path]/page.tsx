/**
 * @fileType page
 * @domain reports
 * @pattern reports-files-page
 * @ai-summary Deep links into the reports workspace — old family links
 *   (/reports/<slug>) and run files (/reports/<slug>/<run>.md).
 */
import type { Metadata } from "next";
import { ReportsFilesView } from "@dashboard/lib/components/ReportsFilesView";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildKodyMetadata({
  title: "Reports — Kody Operations Dashboard",
  description: "Browse report families and runs.",
  path: "/reports",
});

export default async function ReportsPathRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <ReportsFilesView initialPath={path.join("/")} />;
}
