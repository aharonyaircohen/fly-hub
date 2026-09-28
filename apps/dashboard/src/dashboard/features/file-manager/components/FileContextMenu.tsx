/**
 * @fileType component
 * @domain files
 * @pattern file-context-menu
 * @ai-summary Right-click context menu for file/folder operations:
 *   rename, delete, new file, new folder, copy path.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  Trash2,
  Pencil,
  FolderPlus,
  FilePlus,
  Copy,
  Download,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";

interface FileContextMenuProps {
  x: number;
  y: number;
  path: string;
  pathType?: "file" | "dir" | "symlink";
  onClose: () => void;
  onRename?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDelete?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDuplicate?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDownload?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onOpenOnGitHub?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onCopyPath?: (path: string) => void;
  writeable?: boolean;
}

export function FileContextMenu({
  x,
  y,
  path,
  pathType,
  onClose,
  onRename,
  onDelete,
  onDuplicate,
  onDownload,
  onOpenOnGitHub,
  onNewFile,
  onNewFolder,
  onCopyPath,
  writeable = false,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const dirPath =
    pathType === "dir"
      ? path
      : path.includes("/")
        ? path.substring(0, path.lastIndexOf("/"))
        : "";

  useEffect(() => {
    // Adjust position if menu goes off screen
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success("Path copied to clipboard");
    });
    onClose();
  };

  const handleRename = () => {
    if (onRename && pathType) onRename(path, pathType);
    onClose();
  };

  const handleDelete = () => {
    if (onDelete && pathType) onDelete(path, pathType);
    onClose();
  };

  const handleDuplicate = () => {
    if (onDuplicate && pathType) onDuplicate(path, pathType);
    onClose();
  };

  const handleDownload = () => {
    if (onDownload && pathType) onDownload(path, pathType);
    onClose();
  };

  const handleOpenOnGitHub = () => {
    if (onOpenOnGitHub && pathType) onOpenOnGitHub(path, pathType);
    onClose();
  };

  const handleNewFile = () => {
    if (onNewFile) onNewFile(dirPath);
    onClose();
  };

  const handleNewFolder = () => {
    if (onNewFolder) onNewFolder(dirPath);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[160px] rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-xl",
      )}
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]',
          ) ?? [],
        );
        if (items.length === 0) return;
        const currentIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + items.length) % items.length;
        items[nextIndex]?.focus();
      }}
    >
      {onCopyPath && (
        <MenuItem
          icon={<Copy className="w-3.5 h-3.5" />}
          label="Copy path"
          onClick={handleCopyPath}
        />
      )}

      {onOpenOnGitHub && (
        <MenuItem
          icon={<ExternalLink className="w-3.5 h-3.5" />}
          label="Open on GitHub"
          onClick={handleOpenOnGitHub}
        />
      )}

      {pathType === "file" && onDownload && (
        <MenuItem
          icon={<Download className="w-3.5 h-3.5" />}
          label="Download"
          onClick={handleDownload}
        />
      )}

      <MenuDivider />

      {writeable && onNewFile && (
        <MenuItem
          icon={<FilePlus className="w-3.5 h-3.5" />}
          label="New file..."
          onClick={handleNewFile}
        />
      )}

      {writeable && onNewFolder && (
        <MenuItem
          icon={<FolderPlus className="w-3.5 h-3.5" />}
          label="New folder..."
          onClick={handleNewFolder}
        />
      )}

      {writeable && <MenuDivider />}

      {writeable && onRename && (
        <MenuItem
          icon={<Pencil className="w-3.5 h-3.5" />}
          label="Rename or move..."
          onClick={handleRename}
        />
      )}

      {writeable && onDuplicate && (
        <MenuItem
          icon={<Copy className="w-3.5 h-3.5" />}
          label="Duplicate"
          onClick={handleDuplicate}
        />
      )}

      {writeable && onDelete && (
        <>
          <MenuDivider />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />}
            label="Delete"
            className="text-red-400 hover:bg-red-500/10"
            onClick={handleDelete}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="clear"
      className={cn(
        "w-full flex items-center justify-start gap-2 rounded-none px-3 py-1.5 text-sm font-normal text-left",
        "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={onClick}
      role="menuitem"
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-border" role="separator" />;
}
