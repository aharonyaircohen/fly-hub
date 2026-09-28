import { FileSpacesManager } from "@dashboard/features/file-spaces/FileSpacesManager";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Manage Spaces — Kody Operations Dashboard",
  description: "Add and organize repository-backed knowledge spaces.",
  path: "/file-spaces",
});

export default function FileSpacesPage() {
  return <FileSpacesManager />;
}
