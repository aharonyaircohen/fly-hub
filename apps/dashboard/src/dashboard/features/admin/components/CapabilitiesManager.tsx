"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Folder, Loader2, Play, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import {
  kodyApi,
  type CapabilityDetail,
  type CapabilityWriteInput,
} from "@dashboard/lib/api";
import { useRunCapability } from "@dashboard/lib/hooks/useCapabilities";
import { useAuth } from "@dashboard/lib/auth-context";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import {
  type FileEntry,
  type FilesTransport,
} from "@dashboard/features/file-manager";
import { DashboardFilesPage } from "@dashboard/features/file-spaces/DashboardFilesPage";

export interface CapabilityQueryScope {
  owner?: string | null;
  repo?: string | null;
  resource?: "capabilities";
}

export const capabilityQueryKeys = {
  all: ["kody-capabilities"] as const,
  list: (scope: CapabilityQueryScope = {}) =>
    [
      "kody-capabilities",
      scope.resource ?? "capabilities",
      scope.owner ?? null,
      scope.repo ?? null,
    ] as const,
  detail: (slug: string | null, scope: CapabilityQueryScope = {}) =>
    [
      "kody-capability",
      scope.resource ?? "capabilities",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function capabilityFiles(detail: CapabilityDetail): Map<string, string> {
  const root = detail.slug;
  return new Map([
    [`${root}/instructions.md`, detail.instructions],
    ...(detail.contract
      ? [[`${root}/contract.json`, detail.contract] as const]
      : []),
    ...detail.skills.map(
      (skill) =>
        [
          `${root}/skills/${skill.name}`,
          skill.body ?? skill.content ?? "",
        ] as const,
    ),
    ...detail.capabilityTools.map(
      (tool) => [`${root}/tools/${tool.name}`, tool.content ?? ""] as const,
    ),
  ]);
}

function listCapabilityDirectory(
  detail: CapabilityDetail,
  directory: string,
): FileEntry[] {
  const normalized = directory.replace(/^\/+|\/+$/g, "");
  const prefix = normalized ? `${normalized}/` : "";
  const entries = new Map<string, FileEntry>();

  for (const [path, content] of capabilityFiles(detail)) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    if (!remainder) continue;
    const [name, ...rest] = remainder.split("/");
    const childPath = prefix + name;
    const isDirectory = rest.length > 0;
    const current = entries.get(childPath);
    if (!current || isDirectory) {
      entries.set(childPath, {
        name,
        path: childPath,
        type: isDirectory ? "dir" : "file",
        size: isDirectory ? 0 : content.length,
        sha: `capability:${detail.slug}:${childPath}`,
      });
    }
  }

  if (normalized === detail.slug) {
    for (const name of ["skills", "tools"]) {
      const path = `${detail.slug}/${name}`;
      entries.set(path, {
        name,
        path,
        type: "dir",
        size: 0,
        sha: `capability:${detail.slug}:${path}`,
      });
    }
  }

  return [...entries.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function capabilityWriteInput(
  detail: CapabilityDetail,
  files: Map<string, string>,
): CapabilityWriteInput {
  const root = `${detail.slug}/`;
  const assets = (folder: "skills" | "tools") =>
    [...files.entries()]
      .filter(([path]) => path.startsWith(`${root}${folder}/`))
      .map(([path, content]) => ({
        path: path.slice(`${root}${folder}/`.length),
        content,
      }));

  return {
    slug: detail.slug,
    instructions: files.get(`${root}instructions.md`) ?? "",
    contract: files.get(`${root}contract.json`) ?? null,
    skills: assets("skills"),
    tools: assets("tools"),
  };
}

function isCapabilityAssetPath(path: string, slug: string): boolean {
  const relative = path.startsWith(`${slug}/`)
    ? path.slice(slug.length + 1)
    : "";
  return (
    (relative.startsWith("skills/") || relative.startsWith("tools/")) &&
    !relative.endsWith("/") &&
    relative.split("/").every(Boolean)
  );
}

export function CapabilitiesWorkspace({
  basePath = "/capabilities",
  initialPath = "",
}: {
  basePath?: string;
  initialPath?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const listQuery = useQuery({
    queryKey: capabilityQueryKeys.list({
      owner: auth?.owner,
      repo: auth?.repo,
    }),
    queryFn: () => kodyApi.capabilities.list(),
  });
  const run = useRunCapability();
  const detailsRef = useRef<Map<string, CapabilityDetail>>(new Map());
  const summariesRef = useRef(listQuery.data ?? []);
  summariesRef.current = listQuery.data ?? [];

  const transport = useMemo<FilesTransport | undefined>(() => {
    const summaries = listQuery.data;
    if (!summaries) return undefined;

    const loadDetail = async (capabilitySlug: string) => {
      const known = summariesRef.current.some(
        (item) => item.slug === capabilitySlug,
      );
      if (!known) {
        throw new Error(`Capability "${capabilitySlug}" was not found`);
      }
      const cached = detailsRef.current.get(capabilitySlug);
      if (cached) return cached;
      const detail = await kodyApi.capabilities.get(capabilitySlug);
      detailsRef.current.set(capabilitySlug, detail);
      queryClient.setQueryData(
        capabilityQueryKeys.detail(capabilitySlug),
        detail,
      );
      return detail;
    };

    const saveFiles = async (
      current: CapabilityDetail,
      files: Map<string, string>,
    ) => {
      const updated = await kodyApi.capabilities.update(
        current.slug,
        capabilityWriteInput(current, files),
      );
      detailsRef.current.set(current.slug, updated);
      queryClient.setQueryData(
        capabilityQueryKeys.detail(current.slug),
        updated,
      );
      void queryClient.invalidateQueries({ queryKey: capabilityQueryKeys.all });
    };

    return {
      cacheKey: `capabilities:${JSON.stringify(
        summaries.map((item) => [item.slug, item.readOnly]),
      )}`,
      listDir: async (path) => {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        if (!normalized) {
          return summariesRef.current
            .map<FileEntry>((item) => ({
              name: item.slug,
              path: item.slug,
              type: "dir",
              size: 0,
              sha: `capability:${item.slug}`,
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
        }
        const capabilitySlug = normalized.split("/")[0] ?? "";
        return listCapabilityDirectory(
          await loadDetail(capabilitySlug),
          normalized,
        );
      },
      readFile: async (path) => {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        const capabilitySlug = normalized.split("/")[0] ?? "";
        if (!capabilitySlug) return null;
        const detail = await loadDetail(capabilitySlug);
        const content = capabilityFiles(detail).get(normalized);
        if (content === undefined) return null;
        return {
          path: normalized,
          sha: `capability:${detail.slug}:${normalized}`,
          size: content.length,
          content,
          base64Content: "",
          isBinary: false,
          encoding: "utf-8",
        };
      },
      writeFile: async (path: string, content: string) => {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        const capabilitySlug = normalized.split("/")[0] ?? "";
        const current = await loadDetail(capabilitySlug);
        if (current.readOnly) throw new Error("This capability is read-only");
        if (
          normalized !== `${capabilitySlug}/instructions.md` &&
          normalized !== `${capabilitySlug}/contract.json` &&
          !isCapabilityAssetPath(normalized, capabilitySlug)
        ) {
          throw new Error(
            "Capability files must be instructions.md, contract.json, or files under skills/ and tools/",
          );
        }
        const files = capabilityFiles(current);
        files.set(normalized, content);
        await saveFiles(current, files);
      },
      deleteFile: async (path: string) => {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        const capabilitySlug = normalized.split("/")[0] ?? "";
        const current = await loadDetail(capabilitySlug);
        if (current.readOnly) throw new Error("This capability is read-only");
        if (!isCapabilityAssetPath(normalized, capabilitySlug)) {
          throw new Error(
            "Only files inside skills/ and tools/ can be deleted",
          );
        }
        const files = capabilityFiles(current);
        files.delete(normalized);
        await saveFiles(current, files);
      },
    };
  }, [listQuery.data, queryClient]);

  if (listQuery.error) {
    return (
      <EmptyState
        icon={<Folder />}
        title="Could not open capabilities"
        hint={listQuery.error.message}
      />
    );
  }
  if (listQuery.isLoading || !transport) {
    return (
      <EmptyState icon={<Folder />} title="Loading capability folders..." />
    );
  }

  const protectedPaths = (listQuery.data ?? []).flatMap((item) => [
    item.slug,
    `${item.slug}/instructions.md`,
    `${item.slug}/contract.json`,
    `${item.slug}/skills`,
    `${item.slug}/tools`,
  ]);

  return (
    <DashboardFilesPage
      title="Capabilities"
      routeBase={`${basePath}/files`}
      initialPath={initialPath}
      transport={transport}
      protectedPaths={protectedPaths}
      showSearch={false}
      showUpload={false}
      headerActions={({ selectedPath }) => {
        const selectedSlug = selectedPath?.split("/")[0] ?? "";
        const canRun = (listQuery.data ?? []).some(
          (item) => item.slug === selectedSlug,
        );
        return (
          <>
            {canRun ? (
              <Button
                size="sm"
                onClick={() => run.mutate({ slug: selectedSlug })}
                disabled={run.isPending}
              >
                {run.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run as Kody
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              aria-label="New capability"
              onClick={() => router.push(`${basePath}/new`)}
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
          </>
        );
      }}
    />
  );
}

export function CapabilityEditorPage({
  basePath = "/capabilities",
}: {
  basePath?: string;
}) {
  return <NewCapabilityFolder basePath={basePath} />;
}

function NewCapabilityFolder({ basePath }: { basePath: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (slug: string) =>
      kodyApi.capabilities.create({
        slug,
        instructions:
          "# Instructions\n\nExplain what this capability does and how it uses its one input value.\n",
        contract: `${JSON.stringify({ input: {}, output: {} }, null, 2)}\n`,
        skills: [],
        tools: [],
      }),
    onSuccess: (capability) => {
      void queryClient.invalidateQueries({ queryKey: capabilityQueryKeys.all });
      toast.success("Capability folder created");
      router.push(
        `${basePath}/files/${encodeURIComponent(capability.slug)}/instructions.md`,
      );
    },
    onError: (error: Error) =>
      toast.error("Could not create capability", {
        description: error.message,
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(name.trim());
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-16 max-w-md space-y-5 rounded-lg border border-border p-6"
    >
      <div>
        <h1 className="text-xl font-semibold">New capability folder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create one reusable Kody action. Its instructions and contract are
          stored in Kody and loaded by Engine when a workflow runs.
        </p>
      </div>
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        This does not create a GitHub Actions workflow or a CMS entry. After
        creation, edit <code>instructions.md</code> and{" "}
        <code>contract.json</code>
        in Files.
      </div>
      <Input
        aria-label="Capability folder name"
        placeholder="capability-name"
        value={name}
        required
        pattern="[a-z0-9][a-z0-9_-]*"
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(basePath)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Create folder
        </Button>
      </div>
    </form>
  );
}
