/**
 * @fileType page
 * @domain memory
 * @pattern memory-files-page
 * @ai-summary Internal adapter for the repository-scoped Memory file
 *   workspace, including its root and file deep links.
 */
import { MemoryFilesPage } from "@dashboard/features/memory/components/MemoryFilesPage";
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Memory — Kody Operations Dashboard",
  description: "Manage persistent Kody memory.",
  path: "/memory",
});
export const dynamic = "force-dynamic";

export default async function MemoryPathRoute({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path = [] } = await params;
  const joined = path.join("/");
  return <MemoryFilesPage initialPath={joined} />;
}
