/**
 * @fileType page
 * @domain reports
 * @pattern reports-files-page
 * @ai-summary Reports page — the generic file-manager workspace over the
 *   reports store (families as folders, runs as markdown files).
 */
import type { Metadata } from "next";
import { ReportsFilesView } from "@dashboard/lib/components/ReportsFilesView";
import { buildKodyMetadata } from "../../metadata";

export const metadata: Metadata = buildKodyMetadata({
  title: "Reports — Kody Operations Dashboard",
  description: "Browse report families and runs.",
  path: "/reports",
});

export default function ReportsPage() {
  return <ReportsFilesView />;
}
