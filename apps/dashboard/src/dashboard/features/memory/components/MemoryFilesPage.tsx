"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import {
  type FileEntry,
  type FilesTransport,
} from "@dashboard/features/file-manager";
import { DashboardFilesPage } from "@dashboard/features/file-spaces/DashboardFilesPage";
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { useAuth } from "@dashboard/lib/auth-context";
import { kodyAuthClient } from "@dashboard/lib/auth/kody-auth-client";
import {
  memoryApi,
  type Memory,
  type MemoryKind,
} from "@dashboard/lib/api/memory";
import {
  MEMORY_KINDS,
  memoryFilePath,
  memoryIdFromFilePath,
  memoryMarkdown,
  type MemoryScopeFolder,
} from "../lib/memory-files";
import { MemoryFormDialog } from "./MemoryFormDialog";
import { MemorySearchDialog } from "./MemorySearchDialog";

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function normalizedPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function scopeFolder(memory: Readonly<Memory>): MemoryScopeFolder {
  return memory.scope.kind === "user" ? "personal" : "repository";
}

function directoryEntry(name: string, path: string, size: number): FileEntry {
  return { name, path, type: "dir", size, sha: path };
}

function latestUpdate(memories: readonly Readonly<Memory>[]): string {
  return memories.reduce(
    (latest, memory) => (memory.updatedAt > latest ? memory.updatedAt : latest),
    "",
  );
}

export function MemoryFilesPage({
  initialPath = "",
}: {
  initialPath?: string;
}) {
  const { auth } = useAuth();
  const { data: kodySession } = kodyAuthClient.useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const repositoryScoped = pathname.startsWith("/repo/") && Boolean(auth);
  const repositoryScope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const apiAuth = repositoryScoped ? auth : null;
  const personalScope = kodySession?.user.id ?? "anonymous";
  const activeScope = repositoryScoped
    ? repositoryScope
    : `user:${personalScope}`;
  const visibleScopeFolders = useMemo<readonly MemoryScopeFolder[]>(
    () => (repositoryScoped ? ["repository"] : ["personal"]),
    [repositoryScoped],
  );
  const routeBase = repositoryScoped
    ? `/repo/${repositoryScope}/memory`
    : "/memory";
  const queryKey = useMemo(
    () => ["memory-files", activeScope] as const,
    [activeScope],
  );
  const memoriesQuery = useQuery({
    queryKey,
    queryFn: () =>
      memoryApi.list(repositoryScoped ? "repository" : "user", apiAuth),
    enabled: Boolean(kodySession?.user),
    staleTime: 30_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const memories = useMemo(
    () => memoriesQuery.data ?? [],
    [memoriesQuery.data],
  );
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<Readonly<Memory> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activePathRef = useRef(initialPath);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const transport = useMemo<FilesTransport>(
    () => ({
      cacheKey: `memory:${activeScope}`,
      dataVersion: latestUpdate(memories),
      async listDir(path: string): Promise<FileEntry[]> {
        if (memoriesQuery.error instanceof Error) throw memoriesQuery.error;
        const parts = normalizedPath(path).split("/").filter(Boolean);
        if (parts.length === 0) {
          return visibleScopeFolders.map((scope) =>
            directoryEntry(
              titleCase(scope),
              scope,
              memories.filter((memory) => scopeFolder(memory) === scope).length,
            ),
          );
        }
        const scope = parts[0] as MemoryScopeFolder;
        if (!visibleScopeFolders.includes(scope)) return [];
        if (parts.length === 1) {
          return MEMORY_KINDS.map((kind) =>
            directoryEntry(
              titleCase(kind),
              `${scope}/${kind}`,
              memories.filter(
                (memory) =>
                  scopeFolder(memory) === scope && memory.kind === kind,
              ).length,
            ),
          );
        }
        const kind = parts[1] as MemoryKind;
        if (parts.length !== 2 || !MEMORY_KINDS.includes(kind)) return [];
        return memories
          .filter(
            (memory) => scopeFolder(memory) === scope && memory.kind === kind,
          )
          .map((memory) => ({
            name: `${memory.content.title}.md`,
            path: memoryFilePath(memory),
            type: "file" as const,
            size: memory.content.body.length,
            sha: memory.currentRevisionId,
          }));
      },
      async readFile(path: string) {
        const id = memoryIdFromFilePath(path);
        if (!id) return null;
        const detail = await memoryApi.get(id, apiAuth);
        if (memoryFilePath(detail.memory) !== normalizedPath(path)) return null;
        const content = memoryMarkdown(detail.memory, detail.revisions);
        return {
          path,
          sha: detail.memory.currentRevisionId,
          size: content.length,
          content,
          base64Content: "",
          isBinary: false,
          encoding: "utf-8" as const,
        };
      },
    }),
    [activeScope, apiAuth, memories, memoriesQuery.error, visibleScopeFolders],
  );

  const memoryForPath = useCallback(
    (path: string | null) => {
      const id = path ? memoryIdFromFilePath(path) : null;
      return id ? (memories.find((memory) => memory.id === id) ?? null) : null;
    },
    [memories],
  );

  async function deleteMemory(memory: Readonly<Memory>) {
    if (
      !window.confirm(
        `Delete "${memory.content.title}" and its revision history?`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await memoryApi.remove(memory.id, apiAuth);
      activePathRef.current = "";
      router.replace(routeBase);
      void invalidate();
      toast.success("Memory deleted");
    } catch (error) {
      toast.error("Could not delete memory", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setDeleting(false);
    }
  }

  const memoryActions = ({
    selectedPath,
  }: {
    selectedPath: string | null;
    isFile: boolean;
  }) => {
    activePathRef.current = selectedPath ?? "";
    const selected = memoryForPath(selectedPath);
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="New memory"
          aria-label="New memory"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Search memory"
          aria-label="Search memory"
          onClick={() => setSearching(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
        {selected ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Edit memory"
              aria-label="Edit memory"
              onClick={() => setEditing(selected)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Delete memory"
              aria-label="Delete memory"
              disabled={deleting}
              onClick={() => void deleteMemory(selected)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : null}
      </>
    );
  };

  const routeToMemory = useCallback(
    (memory: Readonly<Memory>) => {
      const path = memoryFilePath(memory);
      activePathRef.current = path;
      router.replace(`${routeBase}/${path}`);
    },
    [routeBase, router],
  );

  const handleSavedMemory = useCallback(
    (savedMemory: Readonly<Memory>) => {
      queryClient.setQueryData<readonly Readonly<Memory>[]>(
        queryKey,
        (current = []) => {
          const existingIndex = current.findIndex(
            (memory) => memory.id === savedMemory.id,
          );
          if (existingIndex < 0) return [...current, savedMemory];
          return current.map((memory, index) =>
            index === existingIndex ? savedMemory : memory,
          );
        },
      );
      routeToMemory(savedMemory);
      void invalidate();
    },
    [invalidate, queryClient, queryKey, routeToMemory],
  );

  return (
    <AuthGuard>
      <DashboardFilesPage
        title={repositoryScoped ? "Repository Memory" : "Personal Memory"}
        subtitle={
          repositoryScoped && auth
            ? `${auth.owner}/${auth.repo}`
            : "Your Kody memory"
        }
        routeBase="/memory"
        initialPath={activePathRef.current}
        transport={transport}
        headerActions={memoryActions}
        showSearch={false}
        showUpload={false}
        defaultFileMode="view"
      />

      <MemoryFormDialog
        open={creating}
        onOpenChange={setCreating}
        allowRepositoryScope={false}
        fixedScope={repositoryScoped ? "repository" : "user"}
        authOverride={apiAuth}
        onSaved={(memory) => {
          setCreating(false);
          handleSavedMemory(memory);
        }}
      />
      <MemoryFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        memory={editing}
        fixedScope={repositoryScoped ? "repository" : "user"}
        authOverride={apiAuth}
        onSaved={(memory) => {
          setEditing(null);
          handleSavedMemory(memory);
        }}
      />
      <MemorySearchDialog
        open={searching}
        onOpenChange={setSearching}
        memories={memories}
        onSelect={routeToMemory}
      />
    </AuthGuard>
  );
}
