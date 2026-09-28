export type RepoPathType = "file" | "dir" | "symlink";
export type FileWorkspaceViewMode =
  "viewer" | "editor" | "diff" | "search" | "upload";

export interface BreadcrumbItem {
  path: string;
  label: string;
}

export function buildBreadcrumbs(path: string): BreadcrumbItem[] {
  if (!path) return [];
  return path.split("/").map((label, index, parts) => ({
    path: parts.slice(0, index + 1).join("/"),
    label,
  }));
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

export function parentRepoPath(path: string | null | undefined): string {
  const normalized = normalizeRepoPath(path ?? "");
  if (!normalized.includes("/")) return "";
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function currentFolderPath(
  path: string | null | undefined,
  pathType: "file" | "dir" | null,
): string {
  if (pathType === "dir") return normalizeRepoPath(path ?? "");
  if (pathType === "file") return parentRepoPath(path);
  return "";
}

export function confineRepoPathToRoot(path: string, rootPath: string): string {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedRoot = normalizeRepoPath(rootPath);
  if (!normalizedRoot) return normalizedPath;
  if (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedPath;
  }
  return normalizedRoot;
}

export function visibleAncestorDirectories(
  path: string,
  pathType: RepoPathType,
  rootPath: string,
): string[] {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedRoot = normalizeRepoPath(rootPath);
  const directoryPath =
    pathType === "dir" ? normalizedPath : parentRepoPath(normalizedPath);
  if (!directoryPath) return [];

  const segments = directoryPath.split("/");
  const directories = segments.map((_, index) =>
    segments.slice(0, index + 1).join("/"),
  );
  return directories.filter(
    (directory) =>
      directory !== normalizedRoot &&
      (!normalizedRoot || directory.startsWith(`${normalizedRoot}/`)),
  );
}

export function joinRepoPath(base: string, child: string): string {
  return normalizeRepoPath(
    [normalizeRepoPath(base), normalizeRepoPath(child)]
      .filter(Boolean)
      .join("/"),
  );
}

export function replacePathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedOld = normalizeRepoPath(oldPrefix);
  const normalizedNew = normalizeRepoPath(newPrefix);
  if (normalizedPath === normalizedOld) return normalizedNew;
  if (!normalizedPath.startsWith(`${normalizedOld}/`)) return normalizedPath;
  return joinRepoPath(
    normalizedNew,
    normalizedPath.slice(normalizedOld.length),
  );
}

export function isExpectedDeletedPath(
  path: string,
  deletedPaths: ReadonlySet<string>,
): boolean {
  const normalizedPath = normalizeRepoPath(path);
  return [...deletedPaths].some(
    (deletedPath) =>
      normalizedPath === deletedPath ||
      normalizedPath.startsWith(`${deletedPath}/`),
  );
}

export function shouldShowWorkspaceLocation(
  selectedPathType: RepoPathType | null,
  viewMode: FileWorkspaceViewMode,
): boolean {
  return (
    selectedPathType !== "file" || !["viewer", "editor"].includes(viewMode)
  );
}

export function duplicatePath(path: string, pathType: RepoPathType): string {
  const normalized = normalizeRepoPath(path);
  const parent = parentRepoPath(normalized);
  const name = normalized.split("/").pop() ?? normalized;
  if (pathType === "dir") return joinRepoPath(parent, `${name}-copy`);

  const dot = name.lastIndexOf(".");
  const copyName =
    dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
  return joinRepoPath(parent, copyName);
}

export function githubFileUrl(
  owner: string,
  repo: string,
  path: string,
  pathType: RepoPathType | null,
): string {
  const normalized = normalizeRepoPath(path);
  const view = pathType === "dir" ? "tree" : "blob";
  const suffix = normalized
    ? `/${normalized.split("/").map(encodeURIComponent).join("/")}`
    : "";
  return `https://github.com/${owner}/${repo}/${view}/HEAD${suffix}`;
}

export function buildFileHref(path: string | null | undefined): string {
  const normalized = normalizeRepoPath(path ?? "");
  if (!normalized) return "/files";
  return `/files/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

export function buildWorkspaceFileHref(
  routeBase: string,
  path: string | null | undefined,
): string {
  const normalizedBase = `/${normalizeRepoPath(routeBase)}`;
  const normalizedPath = normalizeRepoPath(path ?? "");
  if (!normalizedPath) return normalizedBase;
  const encodedPath = normalizedPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${normalizedBase}/${encodedPath}`;
}

export function repoPathOpenCandidates(path: string): string[] {
  const normalizedPath = normalizeRepoPath(path);
  const candidates = [normalizedPath];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentPath = candidates[candidates.length - 1]!;
    if (!currentPath.includes("%")) break;
    try {
      const decodedPath = normalizeRepoPath(
        currentPath
          .split("/")
          .map((segment) => decodeURIComponent(segment))
          .join("/"),
      );
      if (!decodedPath || decodedPath === currentPath) break;
      candidates.push(decodedPath);
    } catch {
      break;
    }
  }

  return candidates;
}

export function filePathFromHref(pathname: string): string {
  if (pathname === "/files") return "";
  if (!pathname.startsWith("/files/")) return "";
  return normalizeRepoPath(
    pathname
      .slice("/files/".length)
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .join("/"),
  );
}
