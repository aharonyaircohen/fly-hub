/**
 * @fileType page
 * @domain kody
 * @pattern state-file-view-page
 * @ai-summary State file viewer entry point for deep links like
 *   /state-files/logs/workflows/ci-health/runs/run.jsonl.
 */
import type { Metadata } from "next";

import { StateFilePage } from "@dashboard/lib/components/StateFilePage";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildKodyMetadata({
  title: "State Evidence — Kody Operations Dashboard",
  description: "View Kody runtime state evidence.",
  path: "/state-files",
});

export default async function StateFilesPathRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <StateFilePage initialPath={path.join("/")} />;
}
