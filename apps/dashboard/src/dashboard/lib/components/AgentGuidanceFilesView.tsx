"use client";

import { useCallback, useMemo, useState } from "react";
import { CircleHelp, Users } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FileEntry,
  type FilesTransport,
} from "@dashboard/features/file-manager";
import { DashboardFilesPage } from "@dashboard/features/file-spaces/DashboardFilesPage";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { useAgents } from "../hooks/useAgents";
import {
  createGuidanceApi,
  type GuidanceEntry,
  type GuidanceKind,
} from "../api/guidance";

interface GuidanceDefinition {
  kind: GuidanceKind;
  title: string;
  routeBase: string;
  singular: string;
  purpose: string;
  examples: readonly string[];
  agentScoped?: boolean;
}

function slugFromPath(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean.endsWith(".md") ? clean.slice(0, -3) : clean;
}

export function AgentGuidanceFilesView({
  definition,
  initialPath = "",
}: {
  definition: GuidanceDefinition;
  initialPath?: string;
}) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { data: agents = [] } = useAgents();
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const api = useMemo(
    () => createGuidanceApi(definition.kind),
    [definition.kind],
  );
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const queryKey = useMemo(
    () => ["agent-guidance", definition.kind, scope] as const,
    [definition.kind, scope],
  );
  const entriesQuery = useQuery({
    queryKey,
    queryFn: api.list,
    enabled: Boolean(auth),
    staleTime: 30_000,
  });
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const agentScoped = definition.agentScoped !== false;
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const transport = useMemo<FilesTransport>(() => {
    const visible =
      agentScoped && agentFilter
        ? entries.filter((entry) => entry.agent.includes(agentFilter))
        : entries;
    return {
      cacheKey: `${definition.kind}:${agentFilter ?? "all"}:${visible.length}:${visible[0]?.updatedAt ?? ""}`,
      async listDir(path: string): Promise<FileEntry[]> {
        if (path.replace(/^\/+|\/+$/g, "")) return [];
        return visible.map((entry) => ({
          name: `${entry.slug}.md`,
          path: `${entry.slug}.md`,
          type: "file" as const,
          size: entry.body.length,
          sha: entry.sha,
        }));
      },
      async readFile(path: string) {
        const entry = await api.get(slugFromPath(path));
        return {
          path,
          sha: entry.sha,
          size: entry.body.length,
          content: entry.body,
          base64Content: "",
          isBinary: false,
          encoding: "utf-8" as const,
        };
      },
      async writeFile(path: string, content: string) {
        const slug = slugFromPath(path);
        const body = content.trim() ? content : `# ${slug}\n`;
        const existing = entries.find((entry) => entry.slug === slug);
        if (existing) await api.update(slug, { body });
        else
          await api.create({
            slug,
            body,
            agent: agentScoped ? ["kody"] : ["*"],
          });
        await invalidate();
      },
      async deleteFile(path: string) {
        await api.remove(slugFromPath(path));
        await invalidate();
      },
    };
  }, [agentFilter, agentScoped, api, definition.kind, entries, invalidate]);

  async function updateAudience(entry: GuidanceEntry, agentSlug: string) {
    const next = entry.agent.includes(agentSlug)
      ? entry.agent.filter((slug) => slug !== agentSlug)
      : [...entry.agent, agentSlug];
    if (next.length === 0) {
      toast.error("Keep at least one agent assigned");
      return;
    }
    try {
      await api.update(entry.slug, { agent: next });
      await invalidate();
      toast.success(`Updated audience for ${entry.slug}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update audience",
      );
    }
  }

  const headerActions = ({
    selectedPath,
  }: {
    selectedPath: string | null;
    isFile: boolean;
  }) => {
    const entry = selectedPath
      ? (entries.find((item) => item.slug === slugFromPath(selectedPath)) ??
        null)
      : null;
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${definition.title} writing guide`}
            >
              <CircleHelp className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-3">
            <DropdownMenuLabel>
              How to write {definition.title.toLowerCase()}
            </DropdownMenuLabel>
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              {definition.purpose}
            </p>
            <DropdownMenuSeparator />
            {definition.examples.map((example) => (
              <p key={example} className="px-2 py-1 text-xs">
                • {example}
              </p>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {agentScoped && entry ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title={`Audience: ${entry.agent.join(", ")}`}
                aria-label="Assign agents"
              >
                <Users className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Applies to</DropdownMenuLabel>
              {agents.map((agent) => (
                <DropdownMenuCheckboxItem
                  key={agent.slug}
                  checked={entry.agent.includes(agent.slug)}
                  onCheckedChange={() => void updateAudience(entry, agent.slug)}
                >
                  {agent.slug}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {agentScoped ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={agentFilter ? "secondary" : "ghost"}
                size="sm"
                title="Filter by agent"
              >
                {agentFilter ?? "All agents"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setAgentFilter(null)}>
                All agents
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {agents.map((agent) => (
                <DropdownMenuItem
                  key={agent.slug}
                  onClick={() => setAgentFilter(agent.slug)}
                >
                  {agent.slug}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </>
    );
  };

  return (
    <AuthGuard>
      <DashboardFilesPage
        title={definition.title}
        routeBase={definition.routeBase}
        initialPath={initialPath}
        transport={transport}
        headerActions={headerActions}
        newFileExtension=".md"
        newFilePlaceholder={`${definition.singular} name`}
        newFileNameOnly
        showSearch={false}
        showUpload={false}
        defaultFileMode="edit"
      />
    </AuthGuard>
  );
}

export type { GuidanceDefinition };
