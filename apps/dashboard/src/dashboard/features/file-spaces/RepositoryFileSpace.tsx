"use client";

import type { FileEntry } from "@dashboard/features/file-manager";
import { DashboardFilesPage } from "./DashboardFilesPage";

export function RepositoryFileSpace({
  title,
  rootPath,
  routeBase,
  initialPath = "",
  pinnedEntries,
  protectedPaths,
}: {
  title: string;
  rootPath: string;
  routeBase: string;
  initialPath?: string;
  pinnedEntries?: FileEntry[];
  protectedPaths?: string[];
}) {
  return (
    <DashboardFilesPage
      title={title}
      rootPath={rootPath}
      routeBase={routeBase}
      initialPath={initialPath}
      pinnedEntries={pinnedEntries}
      protectedPaths={protectedPaths}
      newFileExtension=".md"
      newFilePlaceholder="Document title"
      newFileNameOnly
      showSearch={false}
      defaultFileMode="view"
    />
  );
}
