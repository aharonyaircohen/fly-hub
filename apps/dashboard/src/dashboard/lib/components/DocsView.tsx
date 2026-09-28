/**
 * @fileType component
 * @domain docs
 * @pattern focused-file-workspace
 * @ai-summary Configures the shared repository Files workspace for markdown
 *   documents under docs/, with the project README pinned separately.
 */
"use client";

import type { FileEntry } from "@dashboard/features/file-manager";
import { RepositoryFileSpace } from "@dashboard/features/file-spaces/RepositoryFileSpace";

interface DocsViewProps {
  selectedPath?: string | null;
}

const README_ENTRY: FileEntry = {
  name: "Project README",
  path: "README.md",
  type: "file",
  size: 0,
  sha: "",
};

function selectedRepoPath(selectedPath: string | null | undefined): string {
  if (!selectedPath) return "";
  if (selectedPath === "README.md" || selectedPath.startsWith("docs/")) {
    return selectedPath;
  }
  return `docs/${selectedPath}`;
}

export function DocsView({ selectedPath = null }: DocsViewProps = {}) {
  return (
    <RepositoryFileSpace
      title="Docs"
      rootPath="docs"
      routeBase="/docs"
      initialPath={selectedRepoPath(selectedPath)}
      pinnedEntries={[README_ENTRY]}
      protectedPaths={["README.md"]}
    />
  );
}
