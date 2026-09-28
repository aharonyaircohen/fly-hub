import type { FileEntry } from "./repo-files";
import {
  joinRepoPath,
  normalizeRepoPath,
  repoPathOpenCandidates,
} from "./file-paths";

export async function resolveRepoPathFromListings(
  path: string,
  listDirectory: (path: string) => Promise<FileEntry[]>,
): Promise<FileEntry | null> {
  const segments = normalizeRepoPath(path).split("/").filter(Boolean);
  let parentPath = "";
  let resolvedEntry: FileEntry | null = null;

  for (const [index, segment] of segments.entries()) {
    const entries = await listDirectory(parentPath);
    const candidatePaths = repoPathOpenCandidates(
      joinRepoPath(parentPath, segment),
    );
    resolvedEntry =
      candidatePaths
        .map((candidate) => entries.find((entry) => entry.path === candidate))
        .find((entry): entry is FileEntry => entry !== undefined) ?? null;

    if (!resolvedEntry) return null;
    if (index < segments.length - 1 && resolvedEntry.type !== "dir") {
      return null;
    }
    parentPath = resolvedEntry.path;
  }

  return resolvedEntry;
}
