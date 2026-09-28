/**
 * @fileType component
 * @domain preview
 * @pattern env-switcher-dropdown
 * @ai-summary Toolbar dropdown to switch between named preview environments
 *   (Production / Staging / Dev …) and manage the list (add / edit / remove).
 *   Mirrors PreviewViewsBar's popover, but the list is repo-shared state in
 *   backend `dashboard.json`, so mutations route through the parent's `onSave`
 *   (which PUTs the config) instead of localStorage.
 */
"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Clock,
  Folder,
  FolderPlus,
  GitBranch,
  GripVertical,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@dashboard/lib/utils";
import {
  daysUntilExpiry,
  addPreviewFolder,
  isFlyBranchEnvironment,
  removeEnvironment,
  removePreviewFolder,
  reorderEnvironment,
  updateBranchPreviewEnvironment,
  updateEnvironment,
  updatePreviewFolder,
  type PreviewEnvironment,
  type PreviewEnvironmentFolder,
} from "@kody-ade/fly/preview-environments";
import { PreviewBranchEnvForm } from "@dashboard/features/previews/components/PreviewBranchEnvForm";
import { PreviewEnvForm } from "@dashboard/features/previews/components/PreviewEnvForm";
import { PreviewFileUploadButton } from "@dashboard/features/previews/components/PreviewFileUploadButton";
import { PreviewFloatingMenu } from "@dashboard/features/previews/components/PreviewFloatingMenu";

/** Compact expiry chip text + tone for an uploaded preview. */
function expiryChip(
  expiresAt: number,
  now: number,
): { text: string; className: string } {
  const days = daysUntilExpiry(expiresAt, now);
  if (days <= 0) return { text: "expired", className: "text-rose-400/80" };
  if (days === 1) return { text: "1d left", className: "text-amber-400/80" };
  if (days <= 2)
    return { text: `${days}d left`, className: "text-amber-400/80" };
  return { text: `${days}d left`, className: "text-zinc-500" };
}

interface PreviewEnvSwitcherProps {
  environments: PreviewEnvironment[];
  folders?: PreviewEnvironmentFolder[];
  repoFullName: string;
  selectedId: string | null;
  onSelect: (env: PreviewEnvironment) => void;
  /** Persist the next list (parent PUTs backend `dashboard.json`). */
  onSave: (next: PreviewEnvironment[]) => Promise<void>;
  /** Persist user-created bookmark folders. */
  onSaveFolders?: (next: PreviewEnvironmentFolder[]) => Promise<void>;
  /** Add a Fly branch preview environment (parent persists + selects). */
  onAddBranch: (repo: string, branch: string) => Promise<void>;
  /** Upload file(s) into a repo-backed view environment. */
  onUpload?: (files: File[]) => Promise<void>;
  /** Destroy the Fly app behind an uploaded environment, if it has one. */
  onRemoveStatic?: (staticId: string) => Promise<void>;
  /** Delete repo-backed view files behind uploaded view, if any. */
  onRemoveRepoView?: (repoViewPath: string) => Promise<void>;
  /** Push an uploaded environment's expiry out by another TTL. */
  onExtend?: (id: string) => Promise<void>;
  isSaving: boolean;
  variant?: "toolbar" | "address";
}

export function PreviewEnvSwitcher({
  environments,
  folders = [],
  repoFullName,
  selectedId,
  onSelect,
  onSave,
  onSaveFolders,
  onAddBranch,
  onUpload,
  onRemoveStatic,
  onRemoveRepoView,
  onExtend,
  isSaving,
  variant = "toolbar",
}: PreviewEnvSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderEditDraft, setFolderEditDraft] = useState("");
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<
    | { type: "folder"; folderId: string | null }
    | { type: "row"; id: string }
    | null
  >(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const now = Date.now();

  const active = selectedId
    ? (environments.find((environment) => environment.id === selectedId) ??
      null)
    : null;

  const closeMenu = (): void => {
    setMenuOpen(false);
    setAddOpen(false);
    setFolderOpen(false);
    setFolderDraft("");
    setEditingFolderId(null);
    setFolderEditDraft("");
    setEditingId(null);
  };

  const handleAddBranch = async (
    repo: string,
    branch: string,
  ): Promise<void> => {
    await onAddBranch(repo, branch);
    setAddOpen(false);
  };

  const handleEdit = async (
    id: string,
    label: string,
    url: string,
  ): Promise<void> => {
    await onSave(updateEnvironment(environments, id, { label, url }));
    setEditingId(null);
  };

  const handleBranchEdit = async (
    id: string,
    repo: string,
    branch: string,
  ): Promise<void> => {
    await onSave(
      updateBranchPreviewEnvironment(environments, id, repo, branch),
    );
    setEditingId(null);
  };

  const handleRemove = async (id: string): Promise<void> => {
    const removed = environments.find((e) => e.id === id);
    const next = removeEnvironment(environments, id);
    await onSave(next);
    // If we removed the active one, fall back to the first remaining.
    if (id === active?.id && next[0]) onSelect(next[0]);
    // Uploaded environments own a Fly app — tear it down too (best-effort).
    if (removed?.staticId && onRemoveStatic) {
      await onRemoveStatic(removed.staticId);
    }
    if (removed?.repoViewPath && onRemoveRepoView) {
      await onRemoveRepoView(removed.repoViewPath);
    }
  };

  const handleAddFolder = async (): Promise<void> => {
    if (!onSaveFolders) return;
    const next = addPreviewFolder(folders, folderDraft);
    if (next === folders) return;
    await onSaveFolders(next);
    setFolderDraft("");
    setFolderOpen(false);
  };

  const handleRemoveFolder = async (id: string): Promise<void> => {
    if (!onSaveFolders) return;
    const nextEnvironments = environments.map((env) => {
      if (env.folderId !== id) return env;
      const next = { ...env };
      delete next.folderId;
      return next;
    });
    await onSave(nextEnvironments);
    await onSaveFolders(removePreviewFolder(folders, id));
  };

  const handleRenameFolder = async (id: string): Promise<void> => {
    if (!onSaveFolders) return;
    const next = updatePreviewFolder(folders, id, folderEditDraft);
    if (next === folders) return;
    await onSaveFolders(next);
    setEditingFolderId(null);
    setFolderEditDraft("");
  };

  const moveDraggedEnvironment = async (
    folderId: string | null,
    beforeId: string | null = null,
    explicitDraggedId: string | null = null,
  ): Promise<void> => {
    const sourceId = explicitDraggedId ?? draggedId;
    if (!sourceId) return;
    const next = reorderEnvironment(environments, sourceId, beforeId, folderId);
    setDraggedId(null);
    setDropTarget(null);
    await onSave(next);
  };

  const handleUpload = async (files: File[]): Promise<void> => {
    if (!onUpload) return;
    if (files.length === 0) return;
    setUploading(true);
    try {
      await onUpload(files);
      setMenuOpen(false);
    } finally {
      setUploading(false);
    }
  };

  const handleExtend = async (id: string): Promise<void> => {
    if (!onExtend) return;
    setExtendingId(id);
    try {
      await onExtend(id);
    } finally {
      setExtendingId(null);
    }
  };

  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const rootEnvironments = environments.filter(
    (env) => !env.folderId || !knownFolderIds.has(env.folderId),
  );
  const environmentsInFolder = (folderId: string): PreviewEnvironment[] =>
    environments.filter((env) => env.folderId === folderId);
  const toggleFolderCollapsed = (folderId: string): void => {
    setCollapsedFolderIds((ids) =>
      ids.includes(folderId)
        ? ids.filter((id) => id !== folderId)
        : [...ids, folderId],
    );
  };

  const renderEnvironmentRow = (env: PreviewEnvironment) => {
    const selected = env.id === active?.id;
    if (editingId === env.id) {
      return (
        <div key={env.id} className="px-3 py-2 border-b border-zinc-800">
          {isFlyBranchEnvironment(env) ? (
            <PreviewBranchEnvForm
              repoFullName={repoFullName}
              initialBranch={env.flyBranch.branch}
              submitLabel="Save"
              isSaving={isSaving}
              onSubmit={(repo, branch) =>
                handleBranchEdit(env.id, repo, branch)
              }
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <PreviewEnvForm
              initialLabel={env.label}
              initialUrl={env.url ?? ""}
              submitLabel="Save"
              isSaving={isSaving}
              onSubmit={(label, url) => handleEdit(env.id, label, url)}
              onCancel={() => setEditingId(null)}
            />
          )}
        </div>
      );
    }

    const flyBranch = isFlyBranchEnvironment(env) ? env.flyBranch : null;
    return (
      <div
        key={env.id}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        draggable
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(env);
            setMenuOpen(false);
          }
        }}
        onDragStart={(event) => {
          setDraggedId(env.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", env.id);
        }}
        onDragEnd={() => {
          setDraggedId(null);
          setDropTarget(null);
        }}
        onDragOver={(event) => {
          if (!draggedId || draggedId === env.id) return;
          event.preventDefault();
          event.stopPropagation();
          setDropTarget({ type: "row", id: env.id });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const id = draggedId ?? event.dataTransfer.getData("text/plain");
          if (!id || id === env.id) return;
          void moveDraggedEnvironment(env.folderId ?? null, env.id, id);
        }}
        className={cn(
          "group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/70",
          draggedId === env.id && "opacity-50",
          dropTarget?.type === "row" &&
            dropTarget.id === env.id &&
            "ring-1 ring-sky-500/40",
        )}
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
        <Button
          type="button"
          variant="ghost"
          size="clear"
          onClick={() => {
            onSelect(env);
            setMenuOpen(false);
          }}
          className="flex-1 min-w-0 flex items-center justify-start gap-2 rounded-none text-left font-normal hover:bg-transparent"
        >
          <Check
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              selected ? "text-sky-400" : "text-transparent",
            )}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
              {flyBranch && (
                <GitBranch className="h-3 w-3 shrink-0 text-sky-400" />
              )}
              <span className="truncate">{env.label}</span>
              {typeof env.expiresAt === "number" && (
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-normal",
                    expiryChip(env.expiresAt, now).className,
                  )}
                >
                  {expiryChip(env.expiresAt, now).text}
                </span>
              )}
            </span>
            <span className="block text-[11px] text-zinc-500 truncate">
              {flyBranch ? `${flyBranch.repo} @ ${flyBranch.branch}` : env.url}
            </span>
          </span>
        </Button>
        {env.staticId && onExtend && (
          <Button
            type="button"
            variant="ghost"
            size="clear"
            onClick={() => handleExtend(env.id)}
            disabled={extendingId === env.id}
            title="Extend 7 days"
            aria-label={`Extend ${env.label} by 7 days`}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-emerald-300 hover:bg-zinc-700 transition disabled:pointer-events-auto disabled:opacity-100"
          >
            {extendingId === env.id ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Clock className="w-3 h-3" />
            )}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="clear"
          onClick={() => setEditingId(env.id)}
          title="Edit"
          aria-label={`Edit ${env.label}`}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition"
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="clear"
          onClick={() => handleRemove(env.id)}
          title="Remove"
          aria-label={`Remove ${env.label}`}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    );
  };

  const renderDropGroup = (
    folderId: string | null,
    label: string,
    items: PreviewEnvironment[],
    folder?: PreviewEnvironmentFolder,
  ) => {
    const collapsed = folder ? collapsedFolderIds.includes(folder.id) : false;
    const isFolderDropTarget =
      dropTarget?.type === "folder" && dropTarget.folderId === folderId;
    const handleFolderDrop = (event: DragEvent): void => {
      event.preventDefault();
      const id = draggedId ?? event.dataTransfer.getData("text/plain");
      if (!id) return;
      void moveDraggedEnvironment(folderId, null, id);
    };

    return (
      <div
        key={folderId ?? "root"}
        onDragOver={(event) => {
          if (!draggedId) return;
          event.preventDefault();
          setDropTarget({ type: "folder", folderId });
        }}
        onDrop={handleFolderDrop}
        className={cn("py-1", isFolderDropTarget && "bg-sky-500/5")}
      >
        <div
          className={cn(
            "mx-1 flex items-center gap-2 rounded px-2 py-1.5",
            folder
              ? "text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60"
              : "text-[11px] font-medium uppercase tracking-wide text-zinc-500",
            isFolderDropTarget &&
              "bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/50",
          )}
          onDragOver={(event) => {
            if (!draggedId) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTarget({ type: "folder", folderId });
          }}
          onDrop={(event) => {
            event.stopPropagation();
            handleFolderDrop(event);
          }}
        >
          {folder ? (
            editingFolderId === folder.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRenameFolder(folder.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-1"
              >
                {/* eslint-disable-next-line react/forbid-elements -- compact borderless inline-rename input; kit Input's h-11 border/bg styling would visibly change the menu row */}
                <input
                  value={folderEditDraft}
                  onChange={(event) => setFolderEditDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingFolderId(null);
                      setFolderEditDraft("");
                    }
                  }}
                  maxLength={40}
                  autoFocus
                  className="min-w-0 flex-1 rounded bg-zinc-950/80 px-2 py-1 text-sm font-semibold text-white outline-none ring-1 ring-sky-500/50"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="clear"
                  disabled={isSaving}
                  className="rounded px-2 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/10 hover:text-sky-200 disabled:pointer-events-auto disabled:opacity-100 disabled:cursor-wait disabled:text-zinc-600"
                >
                  Save
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => toggleFolderCollapsed(folder.id)}
                className="flex min-w-0 flex-1 items-center justify-start gap-2 rounded-none text-left text-sm font-semibold hover:bg-transparent hover:text-inherit"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${folder.label}`}
              >
                {collapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <Folder className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {isFolderDropTarget ? `Drop into ${label}` : label}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    isFolderDropTarget ? "text-sky-200" : "text-zinc-500",
                  )}
                >
                  {items.length}
                </span>
              </Button>
            )
          ) : (
            <span className="truncate">{label}</span>
          )}
          {folder && onSaveFolders && (
            <div className="ml-auto flex items-center gap-1">
              {editingFolderId !== folder.id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={() => {
                    setEditingFolderId(folder.id);
                    setFolderEditDraft(folder.label);
                  }}
                  title={`Rename ${folder.label}`}
                  aria-label={`Rename ${folder.label}`}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => void handleRemoveFolder(folder.id)}
                title={`Remove ${folder.label}`}
                aria-label={`Remove ${folder.label}`}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        {!collapsed &&
          (items.length > 0 ? (
            items.map(renderEnvironmentRow)
          ) : (
            <div className="px-3 py-1.5 text-[11px] text-zinc-600">
              Drop saved views here
            </div>
          ))}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="clear"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title={
          active
            ? `Switch preview environment: ${active.label}`
            : "Switch preview environment"
        }
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors",
          variant === "address"
            ? "h-10 w-10 justify-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-white"
            : "rounded-md border border-sky-500/20 bg-sky-500/15 px-2.5 py-1 text-sky-300 hover:bg-sky-500/25",
        )}
      >
        <span
          className={cn(
            "truncate",
            variant === "address" ? "sr-only" : "max-w-[10rem]",
          )}
        >
          {active ? active.label : "Environment"}
        </span>
        <ChevronDown
          className={cn(variant === "address" ? "h-4 w-4" : "h-3 w-3")}
        />
      </Button>

      <PreviewFloatingMenu
        open={menuOpen}
        anchorRef={rootRef}
        align="start"
        onClose={closeMenu}
        className="min-w-[18rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
      >
        <div role="listbox" aria-label="Preview environments">
          {renderDropGroup(null, "Saved views", rootEnvironments)}
          {folders.map((folder) =>
            renderDropGroup(
              folder.id,
              folder.label,
              environmentsInFolder(folder.id),
              folder,
            ),
          )}

          {onSaveFolders &&
            (folderOpen ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAddFolder();
                }}
                className="flex items-center gap-1 border-t border-zinc-800 px-3 py-2"
              >
                {/* eslint-disable-next-line react/forbid-elements -- compact borderless menu input; kit Input's h-11 border/bg styling would visibly change the menu row */}
                <input
                  value={folderDraft}
                  onChange={(event) => setFolderDraft(event.target.value)}
                  placeholder="Folder name"
                  maxLength={40}
                  className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="clear"
                  disabled={isSaving}
                  className="rounded px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/10 hover:text-sky-300 disabled:pointer-events-auto disabled:opacity-100 disabled:cursor-wait disabled:text-zinc-600"
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  onClick={() => {
                    setFolderOpen(false);
                    setFolderDraft("");
                  }}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  title="Cancel"
                  aria-label="Cancel folder"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => setFolderOpen(true)}
                className="flex w-full items-center justify-start gap-2 rounded-none border-t border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/70 hover:text-white"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New folder
              </Button>
            ))}

          {addOpen ? (
            <div className="px-3 py-2 border-t border-zinc-800">
              <PreviewBranchEnvForm
                repoFullName={repoFullName}
                isSaving={isSaving}
                onSubmit={handleAddBranch}
                onCancel={() => setAddOpen(false)}
              />
            </div>
          ) : (
            <div className="mt-1 flex items-stretch border-t border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                size="clear"
                onClick={() => setAddOpen(true)}
                className="flex flex-1 items-center justify-start gap-2 rounded-none px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-zinc-800/70 hover:text-sky-300"
              >
                <GitBranch className="w-3.5 h-3.5" />
                Add branch preview
              </Button>
              {onUpload && (
                <PreviewFileUploadButton
                  title="Upload static files to state views"
                  disabled={uploading}
                  onFiles={(files) => void handleUpload(files)}
                  className="items-center border-l border-zinc-800 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-zinc-800/70"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {uploading ? "Uploading..." : "Upload view files"}
                </PreviewFileUploadButton>
              )}
            </div>
          )}
        </div>
      </PreviewFloatingMenu>
    </div>
  );
}
