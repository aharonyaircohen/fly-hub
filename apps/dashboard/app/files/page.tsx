/**
 * @fileType page
 * @domain files
 * @pattern files-page
 * @ai-summary Files page entry point — serves the /files route.
 */
import { DashboardFilesPage } from "@dashboard/features/file-spaces/DashboardFilesPage";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Files — Kody Operations Dashboard",
  description: "Browse and edit files in your repository.",
  path: "/files",
});

export default function FilesRoute() {
  return <DashboardFilesPage />;
}
