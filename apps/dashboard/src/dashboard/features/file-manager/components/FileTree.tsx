/**
 * @fileType component
 * @domain files
 * @pattern file-tree
 * @ai-summary Lazy-loading hierarchical file tree for the /files page.
 *   Fetches directory contents from the GitHub Contents API on expand.
 */
"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  FileQuestion,
  FolderTree,
  PanelLeftClose,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import type { FileEntry } from "../lib/repo-files";
import { useFilesTransport } from "../lib/transport";
import { getFileIcon, getFileIconColor } from "../lib/repo-files-icons";
import { FileContextMenu } from "./FileContextMenu";

type SortKey = "name" | "size" | "lastModified";

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[] | null;
  isOpen: boolean;
  isLoading: boolean;
}

interface FileTreeProps {
  onFileSelect: (path: string) => void;
  onFolderSelect?: (path: string) => void;
  selectedPath: string | null;
  selectedPathType?: FileEntry["type"] | null;
  refreshKey?: number;
  onRefresh: () => void;
  onDelete?: (path: string, pathType: FileEntry["type"]) => void;
  onRename?: (path: string, pathType: FileEntry["type"]) => void;
  onDuplicate?: (path: string, pathType: FileEntry["type"]) => void;
  onDownload?: (path: string, pathType: FileEntry["type"]) => void;
  onOpenOnGitHub?: (path: string, pathType: FileEntry["type"]) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onCopyPath?: (path: string) => void;
  onMove?: (
    path: string,
    pathType: FileEntry["type"],
    targetDir: string,
  ) => void;
  onCollapse?: () => void;
  treeOverlay?: FileTreeOverlay;
  rootPath?: string;
  pinnedEntries?: FileEntry[];
  entryFilter?: (entry: FileEntry) => boolean;
  protectedPaths?: string[];
  variant?: "focused" | "classic";
}

export interface FileTreeOverlay {
  upserts: Record<string, FileEntry>;
  deletes: Record<string, true>;
  version: number;
}

const EMPTY_TREE_OVERLAY: FileTreeOverlay = {
  upserts: {},
  deletes: {},
  version: 0,
};

export function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function pathAndAncestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export type TreeItemKeyAction = "select" | "expand" | "collapse";

export function treeItemKeyAction(
  key: string,
  isDirectory: boolean,
  isOpen: boolean,
): TreeItemKeyAction | null {
  if (key === "Enter" || key === " ") return "select";
  if (!isDirectory) return null;
  if (key === "ArrowRight" && !isOpen) return "expand";
  if (key === "ArrowLeft" && isOpen) return "collapse";
  return null;
}

function normalizeTreePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

export function fileTreeHeaderLabel(rootPath: string): string {
  const normalized = normalizeTreePath(rootPath);
  if (!normalized) return "Workspace";
  if (normalized === "docs") return "Documents";
  return normalized.split("/").pop() ?? normalized;
}

function parentTreePath(path: string): string {
  const normalized = normalizeTreePath(path);
  if (!normalized.includes("/")) return "";
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function applyTreeOverlay(
  entries: FileEntry[],
  dirPath: string,
  overlay: FileTreeOverlay = EMPTY_TREE_OVERLAY,
): FileEntry[] {
  const normalizedDir = normalizeTreePath(dirPath);
  const deletedPaths = Object.keys(overlay.deletes);
  const isDeleted = (path: string) =>
    deletedPaths.some(
      (deleted) => path === deleted || path.startsWith(`${deleted}/`),
    );

  const byPath = new Map<string, FileEntry>();
  for (const entry of entries) {
    if (!isDeleted(entry.path)) byPath.set(entry.path, entry);
  }

  for (const entry of Object.values(overlay.upserts)) {
    if (
      parentTreePath(entry.path) === normalizedDir &&
      !isDeleted(entry.path) &&
      !byPath.has(entry.path)
    ) {
      byPath.set(entry.path, entry);
    }
  }

  for (const deletedPath of deletedPaths) {
    if (parentTreePath(deletedPath) === normalizedDir) {
      byPath.delete(deletedPath);
    }
  }

  return [...byPath.values()];
}

function applyTreeOverlayToChildrenMap(
  childrenMap: Record<string, FileEntry[]>,
  overlay: FileTreeOverlay,
): Record<string, FileEntry[]> {
  const next: Record<string, FileEntry[]> = {};
  for (const [dirPath, entries] of Object.entries(childrenMap)) {
    next[dirPath] = applyTreeOverlay(entries, dirPath, overlay);
  }
  return next;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function sortEntries(entries: FileEntry[], key: SortKey): FileEntry[] {
  return [...entries].sort((a, b) => {
    // Directories always first
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;

    switch (key) {
      case "size":
        return b.size - a.size;
      case "lastModified":
        const dateA = a.lastCommit?.date ?? "";
        const dateB = b.lastCommit?.date ?? "";
        return dateB.localeCompare(dateA);
      case "name":
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

/**
 * Build a `TreeNode[]` from a flat list of `FileEntry`s.
 *
 * For each entry, `children` is:
 * - `null` for files and for closed directories (so the render guard
 *   `node.children?.map(...)` renders nothing for them), and
 * - a recursive `TreeNode[]` for open directories whose children are
 *   present in `childrenMap` (or an empty array while children are
 *   still loading — opening a dir renders the row, and the row's
 *   `isLoading` flag shows the spinner).
 *
 * The caller decides what to pass at the top level (the useQuery data
 * for root, or `childrenMap[dirPath]` for a recursive call).
 */
export function buildTree(
  entries: FileEntry[],
  childrenMap: Record<string, FileEntry[]>,
  openPaths: Set<string>,
  loadingPaths: Set<string>,
  sortKey: SortKey,
): TreeNode[] {
  return sortEntries(entries, sortKey).map((entry) => ({
    entry,
    children:
      entry.type === "dir" && openPaths.has(entry.path)
        ? buildTree(
            childrenMap[entry.path] ?? [],
            childrenMap,
            openPaths,
            loadingPaths,
            sortKey,
          )
        : null,
    isOpen: openPaths.has(entry.path),
    isLoading: loadingPaths.has(entry.path),
  }));
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onFolderSelect?: (path: string) => void;
  selectedPath: string | null;
  sortKey: SortKey;
  onContextMenu: (
    e: React.MouseEvent,
    path: string,
    type: FileEntry["type"],
  ) => void;
  onDragStartMove?: (path: string, pathType: FileEntry["type"]) => void;
  onDragEndMove?: () => void;
  onDragOverFolder?: (path: string) => boolean;
  onDropOnFolder?: (path: string) => void;
  dropTargetPath?: string | null;
  protectedPaths: Set<string>;
  variant: "focused" | "classic";
}

function TreeNodeRow({
  node,
  depth,
  onToggle,
  onSelect,
  onFolderSelect,
  selectedPath,
  sortKey,
  onContextMenu,
  onDragStartMove,
  onDragEndMove,
  onDragOverFolder,
  onDropOnFolder,
  dropTargetPath,
  protectedPaths,
  variant,
}: TreeNodeRowProps) {
  const { entry, isOpen, isLoading } = node;
  const paddingLeft = depth * 16 + 8;
  const isSelected = selectedPath === entry.path;
  const isDir = entry.type === "dir";
  const isDropTarget = isDir && dropTargetPath === entry.path;
  const isProtected = protectedPaths.has(entry.path);

  const Icon = getFileIcon(entry.path, isOpen, entry.type === "symlink", isDir);
  const iconColor = getFileIconColor(
    entry.path,
    isOpen,
    entry.type === "symlink",
    isDir,
  );

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-2 cursor-pointer text-base select-none",
          variant === "focused" ? "py-2.5 rounded-lg" : "py-2 rounded",
          "hover:bg-muted",
          isSelected &&
            (variant === "focused"
              ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
              : "bg-accent text-accent-foreground"),
          isDropTarget && "bg-emerald-500/15 ring-1 ring-emerald-400/40",
        )}
        style={{ paddingLeft }}
        onClick={() => {
          if (isDir) {
            onFolderSelect?.(entry.path);
            onToggle(entry.path);
          } else {
            onSelect(entry.path);
          }
        }}
        onKeyDown={(event) => {
          const action = treeItemKeyAction(event.key, isDir, isOpen);
          if (!action) return;
          event.preventDefault();

          if (action === "select") {
            if (isDir) {
              onFolderSelect?.(entry.path);
              onToggle(entry.path);
            } else {
              onSelect(entry.path);
            }
            return;
          }

          onToggle(entry.path);
        }}
        onContextMenu={(e) => {
          if (!isProtected) onContextMenu(e, entry.path, entry.type);
        }}
        draggable={Boolean(onDragStartMove) && !isProtected}
        onDragStart={(e) => {
          if (!onDragStartMove) return;
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-kody-file-path", entry.path);
          onDragStartMove(entry.path, entry.type);
        }}
        onDragEnd={() => onDragEndMove?.()}
        onDragOver={(e) => {
          if (!isDir || !onDragOverFolder?.(entry.path)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!isDir || !onDropOnFolder) return;
          e.preventDefault();
          e.stopPropagation();
          onDropOnFolder(entry.path);
        }}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? isOpen : undefined}
        aria-selected={isSelected}
      >
        {isDir ? (
          isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
        <span className="truncate">{entry.name}</span>
        {isLoading && (
          <Loader2 className="w-3 h-3 animate-spin shrink-0 ml-auto" />
        )}
        {!isLoading && !isDir && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatBytes(entry.size)}
          </span>
        )}
      </div>
      {node.children?.map((child) => (
        <TreeNodeRow
          key={child.entry.path}
          node={child}
          depth={depth + 1}
          onToggle={onToggle}
          onSelect={onSelect}
          onFolderSelect={onFolderSelect}
          selectedPath={selectedPath}
          sortKey={sortKey}
          onContextMenu={onContextMenu}
          onDragStartMove={onDragStartMove}
          onDragEndMove={onDragEndMove}
          onDragOverFolder={onDragOverFolder}
          onDropOnFolder={onDropOnFolder}
          dropTargetPath={dropTargetPath}
          protectedPaths={protectedPaths}
          variant={variant}
        />
      ))}
    </>
  );
}

export function FileTree({
  onFileSelect,
  onFolderSelect,
  selectedPath,
  selectedPathType = null,
  refreshKey = 0,
  onRefresh,
  onDelete,
  onRename,
  onDuplicate,
  onDownload,
  onOpenOnGitHub,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onMove,
  onCollapse,
  treeOverlay = EMPTY_TREE_OVERLAY,
  rootPath = "",
  pinnedEntries = [],
  entryFilter,
  protectedPaths = [],
  variant = "classic",
}: FileTreeProps) {
  const normalizedRootPath = normalizeTreePath(rootPath);
  const transport = useFilesTransport();
  const canLoad = Boolean(transport);
  const loadDir = useCallback(
    (path: string) => transport!.listDir(path),
    [transport],
  );
  const loadVisibleDir = useCallback(
    async (path: string) => {
      const entries = await loadDir(path);
      return entries.filter((entry) => !entryFilter || entryFilter(entry));
    },
    [entryFilter, loadDir],
  );
  const protectedPathSet = useMemo(
    () => new Set(protectedPaths.map(normalizeTreePath)),
    [protectedPaths],
  );
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const openPathsRef = useRef(openPaths);
  const [childrenMap, setChildrenMap] = useState<Record<string, FileEntry[]>>(
    {},
  );
  const childrenMapRef = useRef(childrenMap);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const sortKey: SortKey = "name";
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: FileEntry["type"];
  } | null>(null);
  const draggedEntryRef = useRef<{
    path: string;
    type: FileEntry["type"];
  } | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  // Load root directory
  const {
    data: rootEntries,
    isLoading: rootLoading,
    error: rootError,
  } = useQuery({
    queryKey: [
      "files-tree",
      normalizedRootPath,
      refreshKey,
      transport?.cacheKey ?? "transport",
      transport?.dataVersion ?? 0,
    ],
    queryFn: () => loadDir(normalizedRootPath),
    enabled: Boolean(transport),
    // File mutations navigate between routes and can remount the tree. Always
    // verify the root listing on mount so a pre-mutation cache cannot restore
    // files or folders that were just moved or deleted.
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    childrenMapRef.current = childrenMap;
  }, [childrenMap]);

  useEffect(() => {
    openPathsRef.current = openPaths;
  }, [openPaths]);

  useEffect(() => {
    const emptyPaths = new Set<string>();
    setOpenPaths(emptyPaths);
    openPathsRef.current = emptyPaths;
    setChildrenMap({});
    childrenMapRef.current = {};
    setLoadingPaths(new Set());
    setTreeError(null);
  }, [normalizedRootPath, transport?.cacheKey]);

  useEffect(() => {
    const expandedPaths = [...openPathsRef.current];
    setChildrenMap({});
    childrenMapRef.current = {};
    setTreeError(null);

    if (!canLoad || expandedPaths.length === 0) {
      setLoadingPaths(new Set());
      return;
    }

    let cancelled = false;
    setLoadingPaths(new Set(expandedPaths));

    const refreshExpandedDirectories = async () => {
      const results = await Promise.all(
        expandedPaths.map(async (path) => {
          try {
            const entries = await loadVisibleDir(path);
            return { entries, path };
          } catch {
            return { entries: null, path };
          }
        }),
      );
      if (cancelled) return;

      const refreshedChildren: Record<string, FileEntry[]> = {};
      let failedPath: string | null = null;
      for (const result of results) {
        if (result.entries) {
          refreshedChildren[result.path] = result.entries;
        } else {
          failedPath ??= result.path;
        }
      }

      setChildrenMap(refreshedChildren);
      childrenMapRef.current = refreshedChildren;
      setLoadingPaths(new Set());
      setTreeError(failedPath ? `Could not load ${failedPath}` : null);
    };

    void refreshExpandedDirectories();
    return () => {
      cancelled = true;
    };
  }, [canLoad, loadVisibleDir, refreshKey]);

  useEffect(() => {
    if (!canLoad || !selectedPath) return;

    const pathsToOpen =
      selectedPathType === "dir"
        ? pathAndAncestorPaths(selectedPath)
        : ancestorPaths(selectedPath);
    if (pathsToOpen.length === 0) return;

    let cancelled = false;

    const openSelectedPath = async () => {
      for (const path of pathsToOpen) {
        if (cancelled) return;

        setOpenPaths((prev) => new Set(prev).add(path));
        if (childrenMapRef.current[path]) continue;

        setLoadingPaths((prev) => new Set(prev).add(path));
        try {
          const entries = await loadVisibleDir(path);
          if (cancelled) return;
          setChildrenMap((prev) => {
            if (prev[path]) return prev;
            return { ...prev, [path]: entries };
          });
        } catch {
          // The selected path may be a file; only its real directories open.
        } finally {
          if (!cancelled) {
            setLoadingPaths((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
          }
        }
      }
    };

    void openSelectedPath();

    return () => {
      cancelled = true;
    };
  }, [canLoad, loadVisibleDir, selectedPath, selectedPathType]);

  const handleToggle = useCallback(
    async (path: string) => {
      if (openPaths.has(path)) {
        // Close
        setOpenPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } else {
        // Open — load children if not cached
        if (!childrenMap[path]) {
          setLoadingPaths((prev) => new Set(prev).add(path));
          setTreeError(null);
          try {
            const entries = await loadVisibleDir(path);
            setChildrenMap((prev) => ({ ...prev, [path]: entries }));
          } catch {
            setTreeError(`Could not load ${path}`);
            return;
          } finally {
            setLoadingPaths((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
          }
        }
        setOpenPaths((prev) => new Set(prev).add(path));
      }
    },
    [openPaths, childrenMap, loadVisibleDir],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onFileSelect(path);
    },
    [onFileSelect],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, type: FileEntry["type"]) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, path, type });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const canDropOnFolder = useCallback(
    (targetDir: string) => {
      const activeEntry = draggedEntryRef.current;
      if (!activeEntry || !onMove) return false;
      if (activeEntry.path === targetDir) return false;
      if (
        activeEntry.type === "dir" &&
        targetDir.startsWith(`${activeEntry.path}/`)
      ) {
        return false;
      }
      return true;
    },
    [onMove],
  );

  const handleDragStartMove = useCallback(
    (path: string, type: FileEntry["type"]) => {
      const entry = { path, type };
      draggedEntryRef.current = entry;
    },
    [],
  );

  const handleDragEndMove = useCallback(() => {
    draggedEntryRef.current = null;
    setDropTargetPath(null);
  }, []);

  const handleDragOverFolder = useCallback(
    (targetDir: string) => {
      const canDrop = canDropOnFolder(targetDir);
      setDropTargetPath(canDrop ? targetDir : null);
      return canDrop;
    },
    [canDropOnFolder],
  );

  const handleDropOnFolder = useCallback(
    (targetDir: string) => {
      const activeEntry = draggedEntryRef.current;
      if (activeEntry && canDropOnFolder(targetDir)) {
        onMove?.(activeEntry.path, activeEntry.type, targetDir);
      }
      draggedEntryRef.current = null;
      setDropTargetPath(null);
    },
    [canDropOnFolder, onMove],
  );

  const handleDragOverRoot = useCallback(
    (event: React.DragEvent) => {
      if (!canDropOnFolder(normalizedRootPath)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTargetPath(normalizedRootPath);
    },
    [canDropOnFolder, normalizedRootPath],
  );

  const handleDropOnRoot = useCallback(
    (event: React.DragEvent) => {
      const activeEntry = draggedEntryRef.current;
      if (!activeEntry || !canDropOnFolder(normalizedRootPath)) return;
      event.preventDefault();
      onMove?.(activeEntry.path, activeEntry.type, normalizedRootPath);
      draggedEntryRef.current = null;
      setDropTargetPath(null);
    },
    [canDropOnFolder, normalizedRootPath, onMove],
  );

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener("click", handler);
      return () => document.removeEventListener("click", handler);
    }
  }, [contextMenu, closeContextMenu]);

  // Build tree nodes from open paths
  const displayRootEntries = useMemo(
    () =>
      applyTreeOverlay(
        [
          ...pinnedEntries,
          ...(rootEntries ?? []).filter(
            (entry) => !entryFilter || entryFilter(entry),
          ),
        ],
        normalizedRootPath,
        treeOverlay,
      ),
    [entryFilter, normalizedRootPath, pinnedEntries, rootEntries, treeOverlay],
  );
  const displayChildrenMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(
          applyTreeOverlayToChildrenMap(childrenMap, treeOverlay),
        ).map(([path, entries]) => [
          path,
          entries.filter((entry) => !entryFilter || entryFilter(entry)),
        ]),
      ),
    [childrenMap, entryFilter, treeOverlay],
  );
  const rootNodes: TreeNode[] = buildTree(
    displayRootEntries,
    displayChildrenMap,
    openPaths,
    loadingPaths,
    sortKey,
  );

  return (
    <div
      className="flex flex-col h-full"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          "flex min-h-[4.75rem] shrink-0 items-center gap-3 border-b border-border px-4",
          dropTargetPath === normalizedRootPath && "bg-emerald-500/10",
        )}
        data-testid="file-tree-root-drop-target"
        onDragOver={handleDragOverRoot}
        onDrop={handleDropOnRoot}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10">
          <FolderTree className="h-[1.1rem] w-[1.1rem] text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[0.62rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Navigation
          </p>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {fileTreeHeaderLabel(normalizedRootPath)}
            </h2>
            {!rootLoading ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.62rem] text-muted-foreground">
                {rootNodes.length}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="clear"
          onClick={onRefresh}
          className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Refresh"
          aria-label="Refresh files"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {onCollapse && (
          <Button
            variant="ghost"
            size="clear"
            onClick={onCollapse}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Hide file panel"
            aria-label="Hide file panel"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Tree */}
      <div
        className={cn(
          "flex-1 overflow-y-auto px-2 py-3",
          dropTargetPath === normalizedRootPath && "bg-emerald-500/10",
        )}
        role="tree"
        tabIndex={0}
        onDragOver={handleDragOverRoot}
        onDrop={handleDropOnRoot}
      >
        {rootLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rootError ? (
          <div
            className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-destructive"
            role="alert"
          >
            <FileQuestion className="h-8 w-8" />
            <span>{`Could not load ${fileTreeHeaderLabel(normalizedRootPath)}`}</span>
            <Button
              type="button"
              variant="outline"
              size="clear"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-normal text-foreground hover:bg-muted"
              onClick={() => {
                setTreeError(null);
                onRefresh();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {treeError ? (
              <div
                className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                <FileQuestion className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{treeError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="clear"
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-normal text-foreground hover:bg-muted"
                  onClick={() => {
                    setTreeError(null);
                    onRefresh();
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {rootNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-base text-muted-foreground">
                <FileQuestion className="w-8 h-8 mb-2" />
                <span>This folder is empty</span>
              </div>
            ) : (
              rootNodes.map((node) => (
                <TreeNodeRow
                  key={node.entry.path}
                  node={node}
                  depth={0}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  onFolderSelect={onFolderSelect}
                  selectedPath={selectedPath}
                  sortKey={sortKey}
                  onContextMenu={handleContextMenu}
                  onDragStartMove={onMove ? handleDragStartMove : undefined}
                  onDragEndMove={handleDragEndMove}
                  onDragOverFolder={handleDragOverFolder}
                  onDropOnFolder={handleDropOnFolder}
                  dropTargetPath={dropTargetPath}
                  protectedPaths={protectedPathSet}
                  variant={variant}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          pathType={contextMenu.type}
          onClose={closeContextMenu}
          onDelete={onDelete}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDownload={onDownload}
          onOpenOnGitHub={onOpenOnGitHub}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          writeable={Boolean(
            onDelete || onRename || onDuplicate || onNewFile || onNewFolder,
          )}
        />
      )}
    </div>
  );
}
