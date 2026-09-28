/**
 * @fileType component
 * @domain files
 * @pattern files-page
 * @ai-summary Main orchestrator for the /files page. Combines FileTree,
 *   FileViewer, FileEditor, FileSearch, UploadZone, and FileContextMenu into
 *   a responsive split-pane layout with breadcrumb navigation.
 */
"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type DragEvent,
  type ReactNode,
} from "react";
import { FilesTransportProvider, type FilesTransport } from "../lib/transport";
import {
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FolderPlus,
  FolderOpen,
  Search,
  Upload,
  LoaderCircle,
  ChevronRight,
  PanelLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@kody-ade/base/utils/ui";
import {
  base64ToBytes,
  type FileEntry,
  getHttpStatus,
} from "../lib/repo-files";
import {
  buildBreadcrumbs,
  buildWorkspaceFileHref,
  confineRepoPathToRoot,
  currentFolderPath,
  duplicatePath,
  isExpectedDeletedPath,
  joinRepoPath,
  normalizeRepoPath,
  shouldShowWorkspaceLocation,
  visibleAncestorDirectories,
  type BreadcrumbItem,
  type FileWorkspaceViewMode,
  type RepoPathType,
} from "../lib/file-paths";
import { resolveRepoPathFromListings } from "../lib/repo-path-resolution";
import { FileTree, type FileTreeOverlay } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { FileLoadingState } from "./FileLoadingState";
import { FileEditor } from "./FileEditor";
import type { FileEditorMode } from "./FileEditor";
import { FileDiffViewer } from "./FileDiffViewer";
import { FileSearch } from "./FileSearch";
import { UploadZone } from "./UploadZone";
import {
  DEFAULT_FILE_UPLOAD_POLICY,
  type FileUploadPolicy,
} from "../lib/file-upload-policy";
import { uploadRepositoryFiles } from "../lib/upload-repository-files";
import { fileSupportsTextEditing } from "../lib/file-preview";
import { FileWorkspaceShell } from "./FileWorkspaceShell";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";

type ViewMode = FileWorkspaceViewMode;
type PanelState = "split" | "hidden";

interface SelectedFile {
  path: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
}

export interface ActiveFileContext {
  path: string;
  content: string | null;
  isBinary: boolean;
  isDirty: boolean;
}

function emptyTreeOverlay(): FileTreeOverlay {
  return { upserts: {}, deletes: {}, version: 0 };
}

function treeEntryForPath(
  path: string,
  type: RepoPathType,
  options: { sha?: string; size?: number } = {},
): FileEntry {
  const normalized = normalizeRepoPath(path);
  return {
    name: normalized.split("/").pop() ?? normalized,
    path: normalized,
    type,
    size: options.size ?? 0,
    sha: options.sha ?? "",
  };
}

export interface FilesPageProps {
  initialPath?: string;
  title?: string;
  rootPath?: string;
  routeBase?: string;
  pinnedEntries?: FileEntry[];
  protectedPaths?: string[];
  entryFilter?: (entry: FileEntry) => boolean;
  newFileExtension?: string;
  newFilePlaceholder?: string;
  newFileNameOnly?: boolean;
  showSearch?: boolean;
  showUpload?: boolean;
  uploadPolicy?: FileUploadPolicy;
  defaultFileMode?: FileEditorMode;
  /**
   * Storage provider for this workspace. Each optional method enables its
   * matching capability. When omitted, the connected GitHub repository is
   * adapted to the same contract.
   */
  transport: FilesTransport | null;
  /** Converts a workspace-local href into the host application's href. */
  resolveHref?: (href: string) => string;
  /** Host-provided workspace identity shown beside the page title. */
  subtitle?: string;
  /** Extra host-page actions rendered in the workspace header. */
  headerActions?: (ctx: {
    selectedPath: string | null;
    isFile: boolean;
  }) => ReactNode;
  /** Reports the selected file and its current editor text to the host. */
  onActiveFileChange?: (file: ActiveFileContext | null) => void;
}

export function FilesPage({
  initialPath = "",
  title = "Files",
  rootPath = "",
  routeBase = "/files",
  pinnedEntries = [],
  protectedPaths = [],
  entryFilter,
  newFileExtension = "",
  newFilePlaceholder = "filename.txt or nested/path.txt",
  newFileNameOnly = false,
  showSearch = true,
  showUpload = true,
  uploadPolicy = DEFAULT_FILE_UPLOAD_POLICY,
  defaultFileMode = "edit",
  transport,
  resolveHref = (href) => href,
  subtitle = "Browse and edit files",
  headerActions,
  onActiveFileChange,
}: FilesPageProps) {
  const activeTransport = transport;

  const initialRepoPath = useMemo(
    () => normalizeRepoPath(initialPath),
    [initialPath],
  );
  const workspaceRoot = useMemo(() => normalizeRepoPath(rootPath), [rootPath]);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openingPathType, setOpeningPathType] = useState<RepoPathType | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("viewer");
  const [panelState, setPanelState] = useState<PanelState>("split");
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newItemPath, setNewItemPath] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    path: string;
    pathType: RepoPathType;
  } | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    path: string;
    pathType: RepoPathType;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [treeOverlay, setTreeOverlay] =
    useState<FileTreeOverlay>(emptyTreeOverlay);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const openRequestRef = useRef(0);
  const openedInitialPathRef = useRef<string | null>(null);
  const previousInitialPathRef = useRef<string | null>(null);
  const dragDepthRef = useRef(0);
  const deletedPathsRef = useRef<Set<string>>(new Set());

  const writeable = Boolean(activeTransport?.writeFile);
  const canDelete = Boolean(activeTransport?.deleteFile);
  const canCreateFolder = Boolean(activeTransport?.createFolder);
  const canUpload = Boolean(activeTransport?.uploadFile);
  const canMove = Boolean(activeTransport?.movePath);
  const canDuplicate = Boolean(activeTransport?.duplicatePath);
  const canSearch = showSearch && Boolean(activeTransport?.search);
  const canViewHistory = Boolean(
    activeTransport?.history && activeTransport?.readVersion,
  );

  useEffect(() => {
    setTreeOverlay(emptyTreeOverlay());
  }, [activeTransport?.cacheKey]);

  // Build breadcrumbs from selected file path
  const breadcrumbs = useMemo<BreadcrumbItem[]>(
    () => (selectedPath ? buildBreadcrumbs(selectedPath) : []),
    [selectedPath],
  );

  const selectedPathType: RepoPathType | null =
    openingPathType ?? (selectedFile ? "file" : selectedPath ? "dir" : null);
  const isSelectedProtected = Boolean(
    selectedPath &&
    protectedPaths
      .map(normalizeRepoPath)
      .includes(normalizeRepoPath(selectedPath)),
  );

  // The route can update before GitHub's directory listing reflects a new
  // commit. Keep the file we have already opened visible in the tree so a
  // route transition or reload cannot temporarily make it disappear.
  const visibleTreeOverlay = useMemo<FileTreeOverlay>(() => {
    if (!selectedPath || !selectedPathType) return treeOverlay;
    const upserts = { ...treeOverlay.upserts };
    for (const directory of visibleAncestorDirectories(
      selectedPath,
      selectedPathType,
      workspaceRoot,
    )) {
      upserts[directory] ??= treeEntryForPath(directory, "dir");
    }
    if (selectedFile) {
      const entry = treeEntryForPath(selectedFile.path, "file", {
        sha: selectedFile.sha,
        size: selectedFile.size,
      });
      upserts[entry.path] = entry;
    }
    return {
      ...treeOverlay,
      upserts,
    };
  }, [
    selectedFile,
    selectedPath,
    selectedPathType,
    treeOverlay,
    workspaceRoot,
  ]);

  const currentFolder = useMemo(() => {
    const selectedFolder = currentFolderPath(
      selectedPath,
      selectedPathType === "symlink" ? "file" : selectedPathType,
    );
    return confineRepoPathToRoot(selectedFolder, workspaceRoot);
  }, [selectedPath, selectedPathType, workspaceRoot]);

  useEffect(() => {
    if (!selectedFile) {
      onActiveFileChange?.(null);
      return;
    }
    onActiveFileChange?.({
      path: selectedFile.path,
      content: selectedFile.content,
      isBinary: selectedFile.isBinary,
      isDirty: false,
    });
  }, [onActiveFileChange, selectedFile]);

  useEffect(
    () => () => {
      onActiveFileChange?.(null);
    },
    [onActiveFileChange],
  );

  const handleEditorContentChange = useCallback(
    (content: string, isDirty: boolean) => {
      if (!selectedFile) return;
      onActiveFileChange?.({
        path: selectedFile.path,
        content,
        isBinary: false,
        isDirty,
      });
    },
    [onActiveFileChange, selectedFile],
  );

  const updateFileHref = useCallback(
    (path: string, options: { replace?: boolean } = {}) => {
      const normalizedPath = normalizeRepoPath(path);
      const relativePath =
        workspaceRoot && normalizedPath.startsWith(`${workspaceRoot}/`)
          ? normalizedPath.slice(workspaceRoot.length + 1)
          : normalizedPath;
      const workspaceHref = buildWorkspaceFileHref(routeBase, relativePath);
      const href = resolveHref(workspaceHref);
      if (typeof window !== "undefined" && window.location.pathname === href) {
        return;
      }

      // FilesPage already owns path selection and popstate restoration. Call
      // the native History API so changing the canonical URL does not remount
      // the Next.js route and briefly discard the active workspace.
      const updateHistory = options.replace
        ? window.History.prototype.replaceState
        : window.History.prototype.pushState;
      updateHistory.call(window.history, null, "", href);
    },
    [routeBase, resolveHref, workspaceRoot],
  );

  const openRepoPath = useCallback(
    async (
      path: string,
      options: {
        updateRoute?: boolean;
        replace?: boolean;
        typeHint?: "file" | "dir";
      } = {},
    ) => {
      const normalizedPath = normalizeRepoPath(path);
      const updateRoute = options.updateRoute ?? true;
      const requestId = ++openRequestRef.current;

      if (!normalizedPath) {
        setOpeningPathType(null);
        setSelectedPath(null);
        setSelectedFile(null);
        setViewMode("viewer");
        if (updateRoute) updateFileHref("", { replace: options.replace });
        return;
      }

      setOpeningPathType(options.typeHint ?? null);
      if (options.typeHint) {
        setSelectedPath(normalizedPath);
      } else {
        // A deep link is not known to be a file or directory until it has
        // resolved against the repository. Keep unresolved URL text out of
        // the tree and viewers so they cannot issue speculative GitHub reads.
        setSelectedPath(null);
        setSelectedFile(null);
        setViewMode("viewer");
      }
      if (options.typeHint === "dir") {
        setSelectedFile(null);
        setViewMode("viewer");
      }
      if (options.typeHint === "file") {
        setSelectedFile(null);
        setViewMode("viewer");
      }
      if (updateRoute) {
        updateFileHref(normalizedPath, { replace: options.replace });
      }

      if (!activeTransport) return;

      try {
        let resolvedPath = normalizedPath;
        if (normalizedPath.includes("%")) {
          const resolvedEntry = await resolveRepoPathFromListings(
            normalizedPath,
            (directoryPath) => activeTransport.listDir(directoryPath),
          );
          if (!resolvedEntry) throw new Error("File not found");
          resolvedPath = resolvedEntry.path;
        }

        const file = await activeTransport.readFile(resolvedPath);
        if (requestId !== openRequestRef.current) return;

        if (file) {
          setOpeningPathType(null);
          setSelectedPath(file.path);
          setSelectedFile({
            path: file.path,
            sha: file.sha,
            size: file.size,
            isBinary: file.isBinary,
            content: file.isBinary ? null : file.content,
          });
          setViewMode(
            writeable && fileSupportsTextEditing(file.path, file.isBinary)
              ? "editor"
              : "viewer",
          );
          if (file.path !== normalizedPath) {
            updateFileHref(file.path, { replace: true });
          }
          return;
        }

        await activeTransport.listDir(resolvedPath);
        if (requestId !== openRequestRef.current) return;
        setOpeningPathType(null);
        setSelectedPath(resolvedPath);
        setSelectedFile(null);
        setViewMode("viewer");
        if (resolvedPath !== normalizedPath) {
          updateFileHref(resolvedPath, { replace: true });
        }
      } catch (err) {
        if (
          getHttpStatus(err) === 404 &&
          isExpectedDeletedPath(normalizedPath, deletedPathsRef.current)
        ) {
          if (requestId !== openRequestRef.current) return;
          setOpeningPathType(null);
          setSelectedPath(null);
          setSelectedFile(null);
          setViewMode("viewer");
          return;
        }
        toast.error(err instanceof Error ? err.message : "Failed to open file");
        if (requestId !== openRequestRef.current) return;
        setOpeningPathType(null);
        setSelectedPath(null);
        setSelectedFile(null);
        setViewMode("viewer");
      }
    },
    [activeTransport, updateFileHref, writeable],
  );

  useEffect(() => {
    if (!activeTransport) return;
    const initialOpenKey = `${activeTransport.cacheKey ?? "workspace"}:${initialRepoPath}`;

    if (!initialRepoPath) {
      if (previousInitialPathRef.current === initialRepoPath) return;
      previousInitialPathRef.current = initialRepoPath;
      openedInitialPathRef.current = initialOpenKey;
      setSelectedPath(null);
      setSelectedFile(null);
      setViewMode("viewer");
      return;
    }

    previousInitialPathRef.current = initialRepoPath;
    if (openedInitialPathRef.current === initialOpenKey) return;
    openedInitialPathRef.current = initialOpenKey;
    void openRepoPath(initialRepoPath, { updateRoute: false });
  }, [activeTransport, initialRepoPath, openRepoPath]);

  useEffect(() => {
    if (
      !activeTransport ||
      activeTransport.dataVersion === undefined ||
      !selectedPath ||
      selectedPathType !== "file"
    ) {
      return;
    }

    let cancelled = false;
    void activeTransport
      .readFile(selectedPath)
      .then((file) => {
        if (cancelled || !file) return;
        setSelectedFile({
          path: file.path,
          sha: file.sha,
          size: file.size,
          isBinary: file.isBinary,
          content: file.isBinary ? null : file.content,
        });
      })
      .catch(() => {
        // Keep the current file visible; the normal refresh/error paths own
        // user-facing failures.
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTransport,
    activeTransport?.dataVersion,
    selectedPath,
    selectedPathType,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      const routeMarker = `${routeBase}/`;
      const markerIndex = window.location.pathname.lastIndexOf(routeMarker);
      const routePath =
        markerIndex >= 0
          ? normalizeRepoPath(
              window.location.pathname.slice(markerIndex + routeMarker.length),
            )
          : "";
      const repoPath =
        routePath === "README.md"
          ? routePath
          : joinRepoPath(workspaceRoot, routePath);
      void openRepoPath(repoPath, {
        updateRoute: false,
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openRepoPath, routeBase, workspaceRoot]);

  const handleViewDiff = useCallback(() => {
    setViewMode("diff");
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const upsertTreeEntry = useCallback((entry: FileEntry) => {
    const normalizedPath = normalizeRepoPath(entry.path);
    const normalizedEntry: FileEntry = {
      ...entry,
      path: normalizedPath,
      name: entry.name || (normalizedPath.split("/").pop() ?? normalizedPath),
    };

    setTreeOverlay((prev) => {
      const deletes = { ...prev.deletes };
      delete deletes[normalizedPath];
      return {
        upserts: { ...prev.upserts, [normalizedPath]: normalizedEntry },
        deletes,
        version: prev.version + 1,
      };
    });
  }, []);

  const upsertTreeAncestors = useCallback(
    (path: string, pathType: RepoPathType) => {
      for (const directory of visibleAncestorDirectories(
        path,
        pathType,
        workspaceRoot,
      )) {
        upsertTreeEntry(treeEntryForPath(directory, "dir"));
      }
    },
    [upsertTreeEntry, workspaceRoot],
  );

  const removeTreePath = useCallback((path: string) => {
    const normalizedPath = normalizeRepoPath(path);
    setTreeOverlay((prev) => {
      const upserts = Object.fromEntries(
        Object.entries(prev.upserts).filter(
          ([entryPath]) =>
            entryPath !== normalizedPath &&
            !entryPath.startsWith(`${normalizedPath}/`),
        ),
      );

      return {
        upserts,
        deletes: { ...prev.deletes, [normalizedPath]: true },
        version: prev.version + 1,
      };
    });
  }, []);

  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!activeTransport?.uploadFile) {
        toast.error("Uploads are not supported in this workspace");
        return;
      }

      const uploadList = Array.from(files).filter((file) => file.name);
      if (uploadList.length === 0) return;

      setUploadingFiles((current) => [...current, ...uploadList]);
      const result = await uploadRepositoryFiles({
        files: uploadList,
        destinationDir: currentFolder,
        workspaceRoot,
        policy: uploadPolicy,
        upload: async (path, file) => {
          const uploaded = await activeTransport.uploadFile!(path, file);
          return { sha: uploaded?.version ?? "" };
        },
        onUploaded: ({ file, path, sha }) => {
          upsertTreeEntry(
            treeEntryForPath(path, "file", {
              sha,
              size: file.size,
            }),
          );
        },
        onRejected: ({ file, error }) =>
          toast.error(`Failed to upload ${file.name}: ${error}`),
      }).finally(() => {
        const completedFiles = new Set(uploadList);
        setUploadingFiles((current) =>
          current.filter((file) => !completedFiles.has(file)),
        );
      });

      if (result.uploaded.length > 0) {
        const folderLabel = currentFolder ? `/${currentFolder}` : "/";
        toast.success(
          `Uploaded ${result.uploaded.length} ${
            result.uploaded.length === 1 ? "file" : "files"
          } to ${folderLabel}`,
        );
        handleRefresh();
      }
    },
    [
      activeTransport,
      currentFolder,
      handleRefresh,
      uploadPolicy,
      upsertTreeEntry,
      workspaceRoot,
    ],
  );

  const isFileDrag = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (!canUpload || !showUpload || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    },
    [canUpload, showUpload],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!canUpload || !showUpload || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
    },
    [canUpload, showUpload],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!canUpload || !showUpload || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    },
    [canUpload, showUpload],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!canUpload || !showUpload || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      void handleUploadFiles(e.dataTransfer.files);
    },
    [canUpload, handleUploadFiles, showUpload],
  );

  const handleNewFile = useCallback((dirPath: string) => {
    setNewItemPath(normalizeRepoPath(dirPath));
    setShowNewFileDialog(true);
  }, []);

  const handleNewFolder = useCallback((dirPath: string) => {
    setNewItemPath(normalizeRepoPath(dirPath));
    setShowNewFolderDialog(true);
  }, []);

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (!activeTransport?.writeFile) return;
      const trimmedName = name.trim();
      if (
        newFileNameOnly &&
        (trimmedName.includes("/") || trimmedName.includes("\\"))
      ) {
        toast.error("Enter a file name without folders");
        return;
      }
      const fileName =
        newFileExtension &&
        !trimmedName.toLowerCase().endsWith(newFileExtension.toLowerCase())
          ? `${trimmedName}${newFileExtension}`
          : trimmedName;
      const path = joinRepoPath(newItemPath || workspaceRoot, fileName);
      if (!path) return;
      try {
        const result = await activeTransport.writeFile(path, "", {
          expectedVersion: null,
        });
        const sha = result?.version ?? "";
        upsertTreeEntry(treeEntryForPath(path, "file", { sha }));
        upsertTreeAncestors(path, "file");
        deletedPathsRef.current.delete(path);
        toast.success(`Created ${path}`);
        setShowNewFileDialog(false);
        setNewItemPath("");
        setSelectedPath(path);
        setSelectedFile({
          path,
          sha,
          size: 0,
          isBinary: false,
          content: "",
        });
        setViewMode(
          writeable && fileSupportsTextEditing(path, false)
            ? "editor"
            : "viewer",
        );
        updateFileHref(path);
        handleRefresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create file",
        );
      }
    },
    [
      activeTransport,
      newItemPath,
      upsertTreeEntry,
      upsertTreeAncestors,
      writeable,
      updateFileHref,
      handleRefresh,
      newFileExtension,
      newFileNameOnly,
      workspaceRoot,
    ],
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (!activeTransport?.createFolder) return;
      const folderPath = joinRepoPath(newItemPath, name);
      if (!folderPath) return;
      const gitkeepPath = `${folderPath}/.gitkeep`;
      try {
        const result = await activeTransport.createFolder(folderPath);
        upsertTreeEntry(treeEntryForPath(folderPath, "dir"));
        upsertTreeAncestors(folderPath, "dir");
        upsertTreeEntry(
          treeEntryForPath(gitkeepPath, "file", {
            sha: result?.version ?? "",
          }),
        );
        deletedPathsRef.current.delete(folderPath);
        toast.success(`Created ${folderPath}/`);
        setShowNewFolderDialog(false);
        setNewItemPath("");
        setSelectedPath(folderPath);
        setSelectedFile(null);
        setViewMode("viewer");
        updateFileHref(folderPath);
        handleRefresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create folder",
        );
      }
    },
    [
      activeTransport,
      newItemPath,
      upsertTreeEntry,
      upsertTreeAncestors,
      updateFileHref,
      handleRefresh,
    ],
  );

  const handleDelete = useCallback(
    async (path: string, pathType: RepoPathType) => {
      if (!activeTransport?.deleteFile) return;
      setShowDeleteConfirm({ path, pathType });
    },
    [activeTransport],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!activeTransport?.deleteFile || !showDeleteConfirm) return;
    const { path, pathType } = showDeleteConfirm;
    setBusyAction("Deleting...");
    try {
      await activeTransport.deleteFile(path, pathType);
      toast.success(`Deleted ${path}`);
      deletedPathsRef.current.add(normalizeRepoPath(path));
      openRequestRef.current += 1;
      removeTreePath(path);
      if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
        setSelectedFile(null);
        setSelectedPath(null);
        setViewMode("viewer");
        updateFileHref("");
      }
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setShowDeleteConfirm(null);
      setBusyAction(null);
    }
  }, [
    activeTransport,
    showDeleteConfirm,
    selectedPath,
    updateFileHref,
    handleRefresh,
    removeTreePath,
  ]);

  const handleRename = useCallback((path: string, pathType: RepoPathType) => {
    setPendingMove({ path, pathType });
    setMoveTarget(path);
  }, []);

  const moveRepoPath = useCallback(
    async (sourcePath: string, pathType: RepoPathType, targetPath: string) => {
      if (!activeTransport?.movePath) return false;
      const target = normalizeRepoPath(targetPath);
      const source = normalizeRepoPath(sourcePath);
      if (!target || target === source) return false;
      if (pathType === "dir" && target.startsWith(`${source}/`)) {
        toast.error("Choose a folder outside the current folder");
        return false;
      }

      await activeTransport.movePath({
        sourcePath: source,
        sourceType: pathType,
        targetPath: target,
      });
      openRequestRef.current += 1;
      setSelectedFile(null);
      setSelectedPath(target);
      setOpeningPathType(pathType);
      setViewMode("viewer");
      removeTreePath(source);
      upsertTreeEntry(treeEntryForPath(target, pathType));
      upsertTreeAncestors(target, pathType);
      deletedPathsRef.current.delete(target);
      toast.success(`Moved ${source} to ${target}`);
      handleRefresh();
      await openRepoPath(target, {
        typeHint: pathType === "dir" ? "dir" : "file",
      });
      return true;
    },
    [
      activeTransport,
      removeTreePath,
      upsertTreeEntry,
      upsertTreeAncestors,
      handleRefresh,
      openRepoPath,
    ],
  );

  const handleConfirmMove = useCallback(async () => {
    if (!pendingMove) return;
    const target = normalizeRepoPath(moveTarget);
    const source = normalizeRepoPath(pendingMove.path);
    if (!target || target === source) return;
    if (pendingMove.pathType === "dir" && target.startsWith(`${source}/`)) {
      toast.error("Choose a folder outside the current folder");
      return;
    }

    setBusyAction("Moving...");
    try {
      const moved = await moveRepoPath(source, pendingMove.pathType, target);
      if (moved) {
        setPendingMove(null);
        setMoveTarget("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move");
    } finally {
      setBusyAction(null);
    }
  }, [pendingMove, moveTarget, moveRepoPath]);

  const handleMoveToFolder = useCallback(
    async (path: string, pathType: RepoPathType, targetDir: string) => {
      const source = normalizeRepoPath(path);
      const name = source.split("/").pop();
      if (!name) return;
      const target = joinRepoPath(targetDir, name);
      if (!target || target === source) return;

      setBusyAction("Moving...");
      try {
        await moveRepoPath(source, pathType, target);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move");
      } finally {
        setBusyAction(null);
      }
    },
    [moveRepoPath],
  );

  const handleDuplicate = useCallback(
    async (path: string, pathType: RepoPathType) => {
      if (!activeTransport?.duplicatePath) return;
      const source = normalizeRepoPath(path);
      const target = duplicatePath(source, pathType);
      setBusyAction("Duplicating...");
      try {
        await activeTransport.duplicatePath({
          sourcePath: source,
          sourceType: pathType,
          targetPath: target,
        });
        toast.success(`Duplicated to ${target}`);
        handleRefresh();
        await openRepoPath(target, {
          typeHint: pathType === "dir" ? "dir" : "file",
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to duplicate");
      } finally {
        setBusyAction(null);
      }
    },
    [activeTransport, handleRefresh, openRepoPath],
  );

  const handleDownload = useCallback(
    async (path: string, pathType: RepoPathType) => {
      if (!activeTransport || pathType === "dir") return;
      try {
        const file = await activeTransport.readFile(path);
        if (!file) throw new Error("File not found");
        const bytes = base64ToBytes(file.base64Content);
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes).buffer]),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() ?? "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to download");
      }
    },
    [activeTransport],
  );

  const handleOpenOnGitHub = useCallback(
    (path: string, pathType: RepoPathType) => {
      const url = activeTransport?.externalUrl?.(path, pathType);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    },
    [activeTransport],
  );
  const canOpenExternally = Boolean(activeTransport?.externalUrl);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success("Path copied to clipboard");
    });
  }, []);

  const handleSearchResultClick = useCallback(
    (path: string, _line?: number) => {
      openRepoPath(path, { typeHint: "file" });
    },
    [openRepoPath],
  );

  const renderMainContent = () => {
    if (openingPathType === "file" && selectedPath && !selectedFile) {
      return (
        <FileLoadingState
          fileName={selectedPath.split("/").pop() ?? selectedPath}
        />
      );
    }

    if (viewMode === "search") {
      return (
        <FileSearch
          onResultClick={handleSearchResultClick}
          onClose={() =>
            setViewMode(
              selectedFile &&
                writeable &&
                fileSupportsTextEditing(
                  selectedFile.path,
                  selectedFile.isBinary,
                )
                ? "editor"
                : selectedFile
                  ? "viewer"
                  : "search",
            )
          }
        />
      );
    }

    if (viewMode === "upload") {
      return (
        <UploadZone
          onUploadComplete={(uploaded) => {
            upsertTreeEntry(
              treeEntryForPath(uploaded.path, "file", {
                sha: uploaded.sha,
                size: uploaded.size,
              }),
            );
            handleRefresh();
          }}
          destinationDir={currentFolder}
          workspaceRoot={workspaceRoot}
          uploadPolicy={uploadPolicy}
        />
      );
    }

    if (viewMode === "diff" && selectedFile) {
      return (
        <FileDiffViewer
          path={selectedFile.path}
          onClose={() =>
            setViewMode(
              writeable &&
                fileSupportsTextEditing(
                  selectedFile.path,
                  selectedFile.isBinary,
                )
                ? "editor"
                : "viewer",
            )
          }
        />
      );
    }

    if (viewMode === "editor" && selectedFile) {
      return (
        <FileEditor
          path={selectedFile.path}
          sha={selectedFile.sha}
          onContentChange={handleEditorContentChange}
          onShowFilePanel={
            panelState === "hidden" ? () => setPanelState("split") : undefined
          }
          defaultMode={defaultFileMode}
        />
      );
    }

    if (selectedFile) {
      return (
        <FileViewer
          path={selectedFile.path}
          sha={selectedFile.sha}
          onViewDiff={canViewHistory ? handleViewDiff : undefined}
          onShowFilePanel={
            panelState === "hidden" ? () => setPanelState("split") : undefined
          }
        />
      );
    }

    if (selectedPath) {
      if (selectedPathType === "dir") {
        const folderName = selectedPath.split("/").pop() ?? selectedPath;
        return (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/15 bg-primary/10">
                <FolderOpen className="h-7 w-7 text-primary" />
              </div>
              <p className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Current space
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {folderName}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Choose an item from the tree, create something new, or drag
                files between folders to reorganize them.
              </p>
              {writeable ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    onClick={() => handleNewFile(selectedPath)}
                    className="gap-2"
                  >
                    <FilePlus className="h-4 w-4" />
                    New file
                  </Button>
                  {canCreateFolder ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleNewFolder(selectedPath)}
                      className="gap-2"
                    >
                      <FolderPlus className="h-4 w-4" />
                      New folder
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      }
      return (
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
          <FolderOpen className="w-12 h-12 mb-4" />
          <p className="text-base">/{selectedPath}</p>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-sm">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/15 bg-primary/10">
            <FolderOpen className="h-7 w-7 text-primary" />
          </div>
          <p className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Choose what you want to work on
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Browse the repository tree, open a file, or create something new.
            Drag items between folders to reorganize them.
          </p>
          {writeable ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => handleNewFile(currentFolder)}
                className="gap-2"
              >
                <FilePlus className="h-4 w-4" />
                New file
              </Button>
              {canCreateFolder ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleNewFolder(currentFolder)}
                  className="gap-2"
                >
                  <FolderPlus className="h-4 w-4" />
                  New folder
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const hasSecondaryHeaderActions =
    canSearch || Boolean(selectedPath) || (canUpload && showUpload);

  const actions = (
    <div className="flex items-center gap-2.5">
      {headerActions?.({
        selectedPath,
        isFile: Boolean(selectedFile),
      })}
      {writeable || hasSecondaryHeaderActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="More file actions"
              aria-label="More file actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {writeable ? (
              <>
                <DropdownMenuItem onClick={() => handleNewFile(currentFolder)}>
                  <FilePlus className="h-4 w-4" />
                  New file
                </DropdownMenuItem>
                {canCreateFolder ? (
                  <DropdownMenuItem
                    onClick={() => handleNewFolder(currentFolder)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    New folder
                  </DropdownMenuItem>
                ) : null}
                {hasSecondaryHeaderActions ? <DropdownMenuSeparator /> : null}
              </>
            ) : null}
            {canSearch ? (
              <DropdownMenuItem onClick={() => setViewMode("search")}>
                <Search className="h-4 w-4" />
                Search
              </DropdownMenuItem>
            ) : null}
            {canOpenExternally && selectedPath && selectedPathType ? (
              <DropdownMenuItem
                onClick={() =>
                  handleOpenOnGitHub(selectedPath, selectedPathType)
                }
              >
                <ExternalLink className="h-4 w-4" />
                Open on GitHub
              </DropdownMenuItem>
            ) : null}
            {selectedFile ? (
              <DropdownMenuItem
                onClick={() => handleDownload(selectedFile.path, "file")}
              >
                <Download className="h-4 w-4" />
                Download
              </DropdownMenuItem>
            ) : null}
            {(canDelete || canMove || canDuplicate) &&
            selectedPath &&
            selectedPathType &&
            !isSelectedProtected ? (
              <>
                <DropdownMenuSeparator />
                {canMove || canDuplicate ? (
                  <>
                    {canMove ? (
                      <DropdownMenuItem
                        onClick={() =>
                          handleRename(selectedPath, selectedPathType)
                        }
                      >
                        <Pencil className="h-4 w-4" />
                        Rename or move
                      </DropdownMenuItem>
                    ) : null}
                    {canDuplicate ? (
                      <DropdownMenuItem
                        onClick={() =>
                          handleDuplicate(selectedPath, selectedPathType)
                        }
                      >
                        <Copy className="h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : null}
                {canDelete ? (
                  <DropdownMenuItem
                    className="text-red-300 focus:text-red-200"
                    onClick={() => handleDelete(selectedPath, selectedPathType)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            {canUpload && showUpload ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setViewMode("upload")}>
                  <Upload className="h-4 w-4" />
                  Upload
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <FilesTransportProvider value={activeTransport ?? null}>
      <FileWorkspaceShell title={title} subtitle={subtitle} actions={actions}>
        <div
          data-testid="file-workspace-drop-target"
          className="relative flex h-full"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Left panel - file tree */}
          {panelState !== "hidden" ? (
            <div className="h-full w-80 shrink-0 border-r border-border bg-card/30 xl:w-[22rem]">
              <FileTree
                onFileSelect={(path) =>
                  openRepoPath(path, { typeHint: "file" })
                }
                onFolderSelect={(path) =>
                  openRepoPath(path, { typeHint: "dir" })
                }
                selectedPath={selectedPath}
                selectedPathType={selectedPathType}
                refreshKey={refreshKey}
                onRefresh={handleRefresh}
                onDelete={canDelete ? handleDelete : undefined}
                onRename={canMove ? handleRename : undefined}
                onDuplicate={canDuplicate ? handleDuplicate : undefined}
                onDownload={handleDownload}
                onOpenOnGitHub={
                  canOpenExternally ? handleOpenOnGitHub : undefined
                }
                onNewFile={writeable ? handleNewFile : undefined}
                onNewFolder={canCreateFolder ? handleNewFolder : undefined}
                onCopyPath={handleCopyPath}
                onMove={canMove ? handleMoveToFolder : undefined}
                onCollapse={() => setPanelState("hidden")}
                treeOverlay={visibleTreeOverlay}
                rootPath={workspaceRoot}
                pinnedEntries={pinnedEntries}
                protectedPaths={protectedPaths}
                entryFilter={entryFilter}
                variant="focused"
              />
            </div>
          ) : null}

          {/* Right panel - content */}
          <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
            {/* Breadcrumb */}
            {shouldShowWorkspaceLocation(selectedPathType, viewMode) ? (
              <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border px-5">
                {panelState === "hidden" && !selectedFile ? (
                  <Button
                    variant="ghost"
                    size="clear"
                    className="mr-2 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setPanelState("split")}
                    title="Show file panel"
                    aria-label="Show file panel"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="clear"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void openRepoPath("")}
                  title="Open workspace root"
                >
                  <FolderOpen className="h-4 w-4 text-primary" />
                  {workspaceRoot || "Workspace"}
                </Button>
                {breadcrumbs.map((crumb, i) => (
                  <div key={crumb.path} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <Button
                      variant="ghost"
                      size="clear"
                      className={cn(
                        "max-w-[160px] truncate text-sm font-normal hover:bg-transparent hover:text-foreground",
                        i === breadcrumbs.length - 1
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => void openRepoPath(crumb.path)}
                    >
                      {crumb.label}
                    </Button>
                  </div>
                ))}
                <span className="ml-auto rounded-full border border-border bg-muted px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {selectedPathType === "file"
                    ? "File"
                    : selectedPathType === "dir"
                      ? "Folder"
                      : "Workspace"}
                </span>
              </div>
            ) : null}

            {/* Main content area */}
            <div className="flex-1 min-h-0">{renderMainContent()}</div>
          </div>

          {writeable && isDraggingFiles ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="rounded-lg border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 px-8 py-6 text-center">
                <Upload className="mx-auto mb-3 h-8 w-8 text-emerald-300" />
                <p className="text-sm font-medium text-foreground">
                  Drop files to upload
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentFolder ? `/${currentFolder}` : "/"}
                </p>
              </div>
            </div>
          ) : null}

          {uploadingFiles.length > 0 ? (
            <div
              role="status"
              aria-live="polite"
              aria-label={
                uploadingFiles.length === 1
                  ? `Uploading ${uploadingFiles[0].name}`
                  : `Uploading ${uploadingFiles.length} files`
              }
              className="absolute bottom-4 right-4 z-40 flex max-w-xs items-center gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 text-sm shadow-lg"
            >
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <span className="truncate font-medium">
                {uploadingFiles.length === 1
                  ? `Uploading ${uploadingFiles[0].name}`
                  : `Uploading ${uploadingFiles.length} files`}
              </span>
            </div>
          ) : null}
        </div>

        {/* New file dialog */}
        {showNewFileDialog && (
          <Dialog
            open
            onOpenChange={(open) => !open && setShowNewFileDialog(false)}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New file</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const input = form.elements.namedItem(
                    "filename",
                  ) as HTMLInputElement;
                  if (input?.value?.trim()) {
                    handleCreateFile(input.value.trim());
                  }
                }}
                className="space-y-4"
              >
                <p className="text-xs text-muted-foreground">
                  Creates in {newItemPath ? `/${newItemPath}` : "/"}.
                </p>
                <Input
                  name="filename"
                  placeholder={newFilePlaceholder}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNewFileDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Create</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* New folder dialog */}
        {showNewFolderDialog && (
          <Dialog
            open
            onOpenChange={(open) => !open && setShowNewFolderDialog(false)}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New folder</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const input = form.elements.namedItem(
                    "foldername",
                  ) as HTMLInputElement;
                  if (input?.value?.trim()) {
                    handleCreateFolder(input.value.trim());
                  }
                }}
                className="space-y-4"
              >
                <p className="text-xs text-muted-foreground">
                  Creates in {newItemPath ? `/${newItemPath}` : "/"}.
                </p>
                <Input
                  name="foldername"
                  placeholder="folder-name or nested/path"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNewFolderDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Create</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* Rename / move dialog */}
        {pendingMove && (
          <Dialog open onOpenChange={(open) => !open && setPendingMove(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Rename or move</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleConfirmMove();
                }}
                className="space-y-4"
              >
                <p className="text-xs text-muted-foreground">
                  Enter the full new repository path.
                </p>
                <Input
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPendingMove(null)}
                    disabled={busyAction !== null}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busyAction !== null}>
                    {busyAction ?? "Move"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete confirmation dialog */}
        {showDeleteConfirm && (
          <Dialog
            open
            onOpenChange={(open) => !open && setShowDeleteConfirm(null)}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  Delete{" "}
                  {showDeleteConfirm.pathType === "dir" ? "folder" : "file"}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Delete{" "}
                <code className="text-foreground">
                  {showDeleteConfirm.path}
                </code>
                ? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(null)}
                  disabled={busyAction !== null}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={busyAction !== null}
                >
                  {busyAction ?? "Delete"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </FileWorkspaceShell>
    </FilesTransportProvider>
  );
}
