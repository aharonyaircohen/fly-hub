"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";
import { Input } from "@kody-ade/base/ui/input";
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { useAuth } from "@dashboard/lib/auth-context";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { repoScopedHref } from "@kody-ade/base/routes";
import {
  createFileSpaceRequest,
  removeFileSpaceRequest,
  reorderFileSpacesRequest,
  renameFileSpaceRequest,
} from "./client";
import type { FileSpace } from "./model";
import { FILE_SPACES_QUERY_KEY, useFileSpaces } from "./use-file-spaces";

type EditorState =
  { kind: "create" } | { kind: "rename"; space: FileSpace } | null;

export function FileSpacesManager() {
  const { auth } = useAuth();
  const query = useFileSpaces();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<FileSpace | null>(null);
  const [title, setTitle] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [FILE_SPACES_QUERY_KEY] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!auth || !editor) throw new Error("No repository selected");
      if (editor.kind === "create") {
        return createFileSpaceRequest(auth, title);
      }
      return renameFileSpaceRequest(auth, editor.space.id, title);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(
        editor?.kind === "create" ? "File space created" : "File space renamed",
      );
      setEditor(null);
    },
    onError: (error: Error) =>
      toast.error(error.message || "Failed to save file space"),
  });

  const removeMutation = useMutation({
    mutationFn: async (space: FileSpace) => {
      if (!auth) throw new Error("No repository selected");
      return removeFileSpaceRequest(auth, space.id);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("File space removed from navigation");
      setDeleting(null);
    },
    onError: (error: Error) =>
      toast.error(error.message || "Failed to remove file space"),
  });

  const reorderMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!auth) throw new Error("No repository selected");
      return reorderFileSpacesRequest(auth, ids);
    },
    onSuccess: refresh,
    onError: (error: Error) =>
      toast.error(error.message || "Failed to reorder file spaces"),
  });

  const openCreate = () => {
    setTitle("");
    setEditor({ kind: "create" });
  };

  const openRename = (space: FileSpace) => {
    setTitle(space.title);
    setEditor({ kind: "rename", space });
  };

  const move = (space: FileSpace, offset: -1 | 1) => {
    const custom = (query.data?.spaces ?? []).filter((item) => !item.builtIn);
    const index = custom.findIndex((item) => item.id === space.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= custom.length) return;
    const next = [...custom];
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorderMutation.mutate(next.map((item) => item.id));
  };

  return (
    <AuthGuard>
      <PageShell
        title="Manage Spaces"
        icon={FolderOpen}
        iconClassName="text-amber-300"
        subtitle="Add and organize repository-backed knowledge spaces"
        backHref={null}
        width="wide"
        actions={
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New space
          </Button>
        }
      >
        {query.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading file spaces…
          </div>
        ) : query.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">
              Couldn&apos;t load file spaces
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-card/40">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Knowledge spaces</h2>
                <p className="text-xs text-muted-foreground">
                  Each space maps to a markdown folder in this repository.
                </p>
              </div>
              <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                {query.data?.spaces.length ?? 0}
              </span>
            </div>
            <div className="divide-y divide-border">
              {query.data?.spaces.map((space, spaceIndex) => {
                const href = space.builtIn
                  ? "/docs"
                  : `/file-spaces/${space.slug}`;
                return (
                  <div
                    key={space.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Link
                      href={auth ? repoScopedHref(auth, href) : href}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {space.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          /{space.rootPath}
                        </span>
                      </span>
                    </Link>
                    {space.builtIn ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Built in
                      </span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${space.title}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openRename(space)}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={
                              spaceIndex <= 1 || reorderMutation.isPending
                            }
                            onClick={() => move(space, -1)}
                          >
                            <ArrowUp className="h-4 w-4" /> Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={
                              spaceIndex ===
                                (query.data?.spaces.length ?? 0) - 1 ||
                              reorderMutation.isPending
                            }
                            onClick={() => move(space, 1)}
                          >
                            <ArrowDown className="h-4 w-4" /> Move down
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleting(space)}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </PageShell>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === "rename"
                ? "Rename file space"
                : "New file space"}
            </DialogTitle>
            <DialogDescription>
              {editor?.kind === "rename"
                ? "Renaming changes only the visible title."
                : "The route and repository folder are generated from this name."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveMutation.mutate();
            }}
            className="space-y-4"
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Notes"
              autoFocus
              maxLength={64}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditor(null)}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending || !title.trim()}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove ${deleting?.title ?? "file space"}?`}
        description="This removes the page from Kody. The repository folder and all its files stay untouched."
        confirmLabel={removeMutation.isPending ? "Removing…" : "Remove"}
        variant="destructive"
        onConfirm={() => deleting && removeMutation.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </AuthGuard>
  );
}
