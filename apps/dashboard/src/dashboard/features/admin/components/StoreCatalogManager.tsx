/**
 * @fileType component
 * @domain kody
 * @pattern store-catalog
 * @ai-summary Browse shared Store assets and add them by reference.
 */

"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Route,
  Bot,
  Clock3,
  Trash2,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";

import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { repoScopedHref } from "@kody-ade/base/routes";
import { cn } from "@dashboard/lib/utils";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { ListSearch } from "@dashboard/lib/components/ListSearch";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { useGuidedFlowChat } from "@kody-ade/kody-chat-dashboard/guided-flows/chat-controller";
import { CREATE_BLUEPRINT_FLOW_ID } from "@kody-ade/kody-chat-dashboard/guided-flows/builtins";
import { applyStoreBlueprint } from "@dashboard/lib/store-blueprint-application";

export type CatalogKind =
  | "all"
  | "solution"
  | "agent"
  | "workflow"
  | "pipeline"
  | "capability"
  | "loop"
  | "trigger"
  | "command"
  | "feature"
  | "blueprint";

type CatalogItemKind = Exclude<CatalogKind, "all" | "solution">;

interface StoreSolutionNode {
  kind: "loop" | "pipeline" | "trigger" | "workflow" | "agent" | "capability";
  slug: string;
  title: string;
  installed: boolean;
  children: StoreSolutionNode[];
}

interface StoreSolution {
  slug: string;
  title: string;
  description: string;
  kind: "solution";
  htmlUrl: string;
  installed: boolean;
  status: "available" | "partial" | "installed";
  tree: StoreSolutionNode[];
}

interface StoreCatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogItemKind;
  htmlUrl: string | null;
  installed?: boolean;
  setupHref?: string | null;
  uninstallBlockedBy?: Array<{
    kind: CatalogItemKind;
    slug: string;
    title?: string;
  }>;
  blueprint?: {
    version: string;
    constraints: string[];
    verification: string[];
    repositoryTypes: string[];
    providers: string[];
  };
}

interface StoreCatalogResponse {
  solutions: StoreSolution[];
  items: StoreCatalogItem[];
}

export interface StoreCatalogViewState {
  kind: CatalogKind;
  search: string;
}

const KIND_FILTERS: Array<{
  id: CatalogKind;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "all", label: "All", icon: Package },
  { id: "solution", label: "Solutions", icon: Package },
  { id: "agent", label: "Agents", icon: Users },
  { id: "workflow", label: "Workflows", icon: Workflow },
  { id: "pipeline", label: "Pipelines", icon: Route },
  { id: "capability", label: "Capabilities", icon: Layers },
  { id: "loop", label: "Loops", icon: Clock3 },
  { id: "trigger", label: "Triggers", icon: Zap },
  { id: "command", label: "Commands", icon: Bot },
  { id: "feature", label: "Features", icon: Package },
  { id: "blueprint", label: "Blueprints", icon: Play },
];

const KIND_LABEL: Record<CatalogItemKind, string> = {
  agent: "Agent",
  workflow: "Workflow",
  pipeline: "Pipeline",
  capability: "Capability",
  loop: "Loop",
  trigger: "Trigger",
  command: "Command",
  feature: "Feature",
  blueprint: "Blueprint",
};

const KIND_COLORS: Record<
  CatalogKind,
  {
    tabActive: string;
    tabIdle: string;
    icon: string;
    iconHover: string;
    borderHover: string;
    tint: string;
    text: string;
  }
> = {
  all: {
    tabActive:
      "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-slate-700 dark:hover:text-slate-100",
    icon: "text-slate-600 dark:text-slate-300",
    iconHover: "group-hover:text-slate-600 dark:group-hover:text-slate-300",
    borderHover: "hover:border-slate-500/30",
    tint: "bg-slate-500/10",
    text: "text-slate-700 dark:text-slate-100",
  },
  solution: {
    tabActive:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-100",
    icon: "text-emerald-600 dark:text-emerald-300",
    iconHover: "group-hover:text-emerald-600 dark:group-hover:text-emerald-300",
    borderHover: "hover:border-emerald-500/30",
    tint: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-100",
  },
  agent: {
    tabActive: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-sky-700 dark:hover:text-sky-100",
    icon: "text-sky-600 dark:text-sky-300",
    iconHover: "group-hover:text-sky-600 dark:group-hover:text-sky-300",
    borderHover: "hover:border-sky-500/30",
    tint: "bg-sky-500/10",
    text: "text-sky-700 dark:text-sky-100",
  },
  workflow: {
    tabActive:
      "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-indigo-700 dark:hover:text-indigo-100",
    icon: "text-indigo-600 dark:text-indigo-300",
    iconHover: "group-hover:text-indigo-600 dark:group-hover:text-indigo-300",
    borderHover: "hover:border-indigo-500/30",
    tint: "bg-indigo-500/10",
    text: "text-indigo-700 dark:text-indigo-100",
  },
  pipeline: {
    tabActive:
      "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-violet-700 dark:hover:text-violet-100",
    icon: "text-violet-600 dark:text-violet-300",
    iconHover: "group-hover:text-violet-600 dark:group-hover:text-violet-300",
    borderHover: "hover:border-violet-500/30",
    tint: "bg-violet-500/10",
    text: "text-violet-700 dark:text-violet-100",
  },
  capability: {
    tabActive:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-100",
    icon: "text-emerald-600 dark:text-emerald-300",
    iconHover: "group-hover:text-emerald-600 dark:group-hover:text-emerald-300",
    borderHover: "hover:border-emerald-500/30",
    tint: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-100",
  },
  loop: {
    tabActive:
      "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-cyan-700 dark:hover:text-cyan-100",
    icon: "text-cyan-600 dark:text-cyan-300",
    iconHover: "group-hover:text-cyan-600 dark:group-hover:text-cyan-300",
    borderHover: "hover:border-cyan-500/30",
    tint: "bg-cyan-500/10",
    text: "text-cyan-700 dark:text-cyan-100",
  },
  trigger: {
    tabActive:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-100",
    icon: "text-amber-600 dark:text-amber-300",
    iconHover: "group-hover:text-amber-600 dark:group-hover:text-amber-300",
    borderHover: "hover:border-amber-500/30",
    tint: "bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-100",
  },
  command: {
    tabActive:
      "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-rose-700 dark:hover:text-rose-100",
    icon: "text-rose-600 dark:text-rose-300",
    iconHover: "group-hover:text-rose-600 dark:group-hover:text-rose-300",
    borderHover: "hover:border-rose-500/30",
    tint: "bg-rose-500/10",
    text: "text-rose-700 dark:text-rose-100",
  },
  feature: {
    tabActive:
      "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-teal-700 dark:hover:text-teal-100",
    icon: "text-teal-600 dark:text-teal-300",
    iconHover: "group-hover:text-teal-600 dark:group-hover:text-teal-300",
    borderHover: "hover:border-teal-500/30",
    tint: "bg-teal-500/10",
    text: "text-teal-700 dark:text-teal-100",
  },
  blueprint: {
    tabActive:
      "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-100",
    tabIdle:
      "border-border bg-background/60 text-muted-foreground hover:text-fuchsia-700 dark:hover:text-fuchsia-100",
    icon: "text-fuchsia-600 dark:text-fuchsia-300",
    iconHover: "group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-300",
    borderHover: "hover:border-fuchsia-500/30",
    tint: "bg-fuchsia-500/10",
    text: "text-fuchsia-700 dark:text-fuchsia-100",
  },
};

const CATEGORY_FILTERS = KIND_FILTERS.filter(
  (filter) => filter.id !== "all" && filter.id !== "solution",
) as Array<{ id: CatalogItemKind; label: string; icon: LucideIcon }>;

const DEFAULT_VIEW_STATE: StoreCatalogViewState = {
  kind: "solution",
  search: "",
};

const CATALOG_KIND_IDS = new Set<CatalogKind>(
  KIND_FILTERS.map((filter) => filter.id),
);

function catalogKindFromParam(value: string | null): CatalogKind {
  return CATALOG_KIND_IDS.has(value as CatalogKind)
    ? (value as CatalogKind)
    : DEFAULT_VIEW_STATE.kind;
}

function viewStateFromSearchParams(
  params: URLSearchParams,
): StoreCatalogViewState {
  return {
    kind: catalogKindFromParam(params.get("filter")),
    search: params.get("q") ?? "",
  };
}

function readCurrentViewState(): StoreCatalogViewState {
  if (typeof window === "undefined") return DEFAULT_VIEW_STATE;
  return viewStateFromSearchParams(new URLSearchParams(window.location.search));
}

function readInitialCatalogKind(selectedKey: string | null): CatalogKind {
  const current = readCurrentViewState();
  if (typeof window === "undefined") return current.kind;
  const params = new URLSearchParams(window.location.search);
  if (params.has("filter") || !selectedKey) return current.kind;
  const selectedKind = selectedKey.split(":", 1)[0] as CatalogKind;
  return CATALOG_KIND_IDS.has(selectedKind) && selectedKind !== "all"
    ? selectedKind
    : current.kind;
}

export function storeCatalogPathWithViewState(
  path: string,
  viewState: StoreCatalogViewState,
): string {
  const params = new URLSearchParams();
  if (viewState.kind !== DEFAULT_VIEW_STATE.kind) {
    params.set("filter", viewState.kind);
  }
  const q = viewState.search.trim();
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function queryText(item: StoreCatalogItem): string {
  return [item.slug, item.title, item.description, displayKindLabel(item)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function solutionQueryText(solution: StoreSolution): string {
  return [solution.slug, solution.title, solution.description]
    .join(" ")
    .toLowerCase();
}

function isWorkflowCatalogItem(item: StoreCatalogItem): boolean {
  return item.kind === "workflow";
}

function displayKindLabel(item: StoreCatalogItem): string {
  return isWorkflowCatalogItem(item) ? "Workflow" : KIND_LABEL[item.kind];
}

function displayKindIcon(item: StoreCatalogItem): LucideIcon {
  if (isWorkflowCatalogItem(item)) return Workflow;
  return (
    KIND_FILTERS.find((filter) => filter.id === item.kind)?.icon ?? Package
  );
}

function displayKindColor(item: StoreCatalogItem) {
  return KIND_COLORS[isWorkflowCatalogItem(item) ? "workflow" : item.kind];
}

function itemMatchesKind(item: StoreCatalogItem, kind: CatalogKind): boolean {
  if (kind === "all") return true;
  if (kind === "solution") return false;
  return item.kind === kind;
}

export function storeCatalogItemKey(item: StoreCatalogItem): string {
  return `${item.kind}:${item.slug}`;
}

function storeCatalogItemPath(
  item: StoreCatalogItem,
  viewState?: StoreCatalogViewState,
): string {
  const path = selectionPath("/store-catalog", item.kind, item.slug);
  return viewState ? storeCatalogPathWithViewState(path, viewState) : path;
}

function storeSolutionKey(solution: StoreSolution): string {
  return `solution:${solution.slug}`;
}

function storeSolutionPath(
  solution: StoreSolution,
  viewState: StoreCatalogViewState,
): string {
  return storeCatalogPathWithViewState(
    selectionPath("/store-catalog", "solution", solution.slug),
    viewState,
  );
}

async function fetchCatalog(
  headers: Record<string, string>,
): Promise<StoreCatalogResponse> {
  const res = await fetch("/api/kody/store-catalog", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    solutions?: StoreSolution[];
    items?: StoreCatalogItem[];
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return {
    solutions: json.solutions ?? [],
    items: json.items ?? [],
  };
}

async function mutateStoreSolution(
  headers: Record<string, string>,
  solution: StoreSolution,
  remove: boolean,
): Promise<void> {
  const res = await fetch("/api/kody/store-catalog/import", {
    method: remove ? "DELETE" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ kind: "solution", slug: solution.slug }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function addCatalogStoreReference(
  headers: Record<string, string>,
  item: StoreCatalogItem,
): Promise<{
  imported: boolean;
  status: "imported" | "already_local";
  path: string;
}> {
  const res = await fetch("/api/kody/store-catalog/import", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      kind: item.kind,
      slug: item.slug,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    imported?: boolean;
    status?: "imported" | "already_local";
    path?: string;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return {
    imported: json.imported === true,
    status: json.status ?? "imported",
    path: json.path ?? "",
  };
}

async function removeCatalogStoreReference(
  headers: Record<string, string>,
  item: StoreCatalogItem,
): Promise<{
  removed: boolean;
  status: "removed" | "already_missing";
  path: string;
}> {
  const res = await fetch("/api/kody/store-catalog/import", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      kind: item.kind,
      slug: item.slug,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    removed?: boolean;
    status?: "removed" | "already_missing";
    path?: string;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return {
    removed: json.removed === true,
    status: json.status ?? "removed",
    path: json.path ?? "",
  };
}

async function invalidateCatalogQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["kody-agent"] }),
    queryClient.invalidateQueries({ queryKey: ["kody-capabilities"] }),
    queryClient.invalidateQueries({ queryKey: ["kody-workflow-definitions"] }),
  ]);
}

export function StoreCatalogManager({
  selectedKey = null,
}: {
  selectedKey?: string | null;
} = {}) {
  const router = useRouter();
  const { startFlow } = useGuidedFlowChat();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const queryKey = [
    "kody-store-catalog",
    auth?.owner ?? null,
    auth?.repo ?? null,
    auth?.storeRepoUrl ?? null,
    auth?.storeRef ?? null,
  ] as const;
  const [search, setSearch] = useState(() => readCurrentViewState().search);
  const [kind, setKind] = useState<CatalogKind>(() =>
    readInitialCatalogKind(selectedKey),
  );

  const catalog = useQuery({
    queryKey,
    queryFn: () => fetchCatalog(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });

  const solutions = useMemo(
    () => catalog.data?.solutions ?? [],
    [catalog.data],
  );
  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data]);
  const filteredBlueprints = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        item.kind === "blueprint" && (!q || queryText(item).includes(q)),
    );
  }, [items, search]);
  const filteredSolutions = useMemo(() => {
    if (kind !== "solution") return [];
    const q = search.trim().toLowerCase();
    return solutions.filter(
      (solution) => !q || solutionQueryText(solution).includes(q),
    );
  }, [kind, search, solutions]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!itemMatchesKind(item, kind)) return false;
      return !q || queryText(item).includes(q);
    });
  }, [items, kind, search]);
  const grouped = useMemo(
    () =>
      CATEGORY_FILTERS.map((filter) => ({
        ...filter,
        items: filtered.filter((item) => itemMatchesKind(item, filter.id)),
      })).filter((group) => group.items.length > 0),
    [filtered],
  );
  const selected = useMemo(
    () =>
      items.find((item) => storeCatalogItemKey(item) === selectedKey) ?? null,
    [items, selectedKey],
  );
  const selectedSolution = useMemo(
    () =>
      solutions.find(
        (solution) => storeSolutionKey(solution) === selectedKey,
      ) ?? null,
    [selectedKey, solutions],
  );
  useEffect(() => {
    if (catalog.isLoading || !catalog.data) return;
    if (
      selectedKey &&
      !items.some((item) => storeCatalogItemKey(item) === selectedKey) &&
      !solutions.some((solution) => storeSolutionKey(solution) === selectedKey)
    ) {
      router.replace(
        storeCatalogPathWithViewState("/store-catalog", { kind, search }),
      );
    }
  }, [
    catalog.data,
    catalog.isLoading,
    items,
    kind,
    router,
    search,
    selectedKey,
    solutions,
  ]);

  const selectCatalogItem = (item: StoreCatalogItem | null) => {
    const viewState = { kind, search };
    router.push(
      item
        ? storeCatalogItemPath(item, viewState)
        : storeCatalogPathWithViewState("/store-catalog", viewState),
      { scroll: false },
    );
  };

  const selectSolution = (solution: StoreSolution | null) => {
    const viewState = { kind, search };
    router.push(
      solution
        ? storeSolutionPath(solution, viewState)
        : storeCatalogPathWithViewState("/store-catalog", viewState),
      { scroll: false },
    );
  };

  const selectCatalogKind = (nextKind: CatalogKind) => {
    setKind(nextKind);
    if (typeof window === "undefined") return;
    router.replace(
      storeCatalogPathWithViewState(window.location.pathname, {
        kind: nextKind,
        search,
      }),
      { scroll: false },
    );
  };

  const installMutation = useMutation({
    mutationFn: (item: StoreCatalogItem) =>
      addCatalogStoreReference(headers, item),
    onSuccess: async (result, item) => {
      await queryClient.invalidateQueries({ queryKey });
      await invalidateCatalogQueries(queryClient);
      if (item.setupHref) {
        toast.success("Installed — opening setup wizard");
        router.push(item.setupHref);
        return;
      }
      toast.success(
        result.imported ? "Installed from Store" : "Already installed",
      );
    },
    onError: (error: Error) => {
      toast.error("Couldn't install store item", {
        description: error.message,
      });
    },
  });
  const uninstallMutation = useMutation({
    mutationFn: (item: StoreCatalogItem) =>
      removeCatalogStoreReference(headers, item),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey });
      await invalidateCatalogQueries(queryClient);
      toast.success(
        result.removed ? "Uninstalled from Store" : "Already uninstalled",
      );
    },
    onError: (error: Error) => {
      toast.error("Couldn't uninstall store item", {
        description: error.message,
      });
    },
  });
  const solutionMutation = useMutation({
    mutationFn: ({
      solution,
      remove,
    }: {
      solution: StoreSolution;
      remove: boolean;
    }) => mutateStoreSolution(headers, solution, remove),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey });
      await invalidateCatalogQueries(queryClient);
      toast.success(
        variables.remove
          ? "Solution entry points removed"
          : "Solution installed with its dependencies",
      );
    },
    onError: (error: Error) => {
      toast.error("Couldn't change Store solution", {
        description: error.message,
      });
    },
  });
  const blueprintMutation = useMutation({
    mutationFn: (item: StoreCatalogItem) => applyStoreBlueprint(headers, item),
    onSuccess: ({ todoSlug }) => {
      if (!auth) return;
      toast.success("Blueprint started — Kody is monitoring it");
      router.push(
        repoScopedHref(auth, `/todos/${encodeURIComponent(todoSlug)}`),
      );
    },
    onError: (error: Error) => {
      toast.error("Couldn't start this Blueprint", {
        description: error.message,
      });
    },
  });
  const pendingStoreItem =
    installMutation.variables ?? uninstallMutation.variables ?? null;
  const pendingStoreItemKey = pendingStoreItem
    ? storeCatalogItemKey(pendingStoreItem)
    : null;

  return (
    <PageShell
      title="Store Catalog"
      icon={Package}
      iconClassName="text-emerald-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      width="full"
      contentClassName="space-y-6"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void catalog.refetch()}
          disabled={catalog.isFetching}
          aria-label="Refresh store catalog"
        >
          <RefreshCw
            className={cn("h-4 w-4", catalog.isFetching && "animate-spin")}
          />
        </Button>
      }
    >
      {catalog.error ? (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {(catalog.error as Error).message}
        </div>
      ) : null}

      {kind === "solution" ? (
        <section className="space-y-5">
          <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-card p-6 md:p-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="max-w-3xl">
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-200">
                  Kody Store
                </span>
                <h2 className="mt-2 text-2xl font-semibold text-foreground md:text-3xl">
                  Start with a complete Solution
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                  Choose an outcome and install its workflows, triggers, loops,
                  agents, and capabilities together. You can review the complete
                  setup before anything is added to this repository.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => selectCatalogKind("all")}
                className="shrink-0 gap-2"
              >
                <Layers className="h-4 w-4" />
                Browse components
              </Button>
            </div>
          </div>
          <ListSearch
            value={search}
            onChange={setSearch}
            placeholder="Search Solutions..."
            ariaLabel="Search Store Solutions"
            accent="emerald"
          />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Browse components
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Install individual Store parts instead of a complete Solution.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectCatalogKind("solution")}
            >
              Back to Solutions
            </Button>
          </div>
          <div className="space-y-3">
            <ListSearch
              value={search}
              onChange={setSearch}
              placeholder="Search components..."
              ariaLabel="Search Store components"
              accent="emerald"
            />
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {KIND_FILTERS.filter((filter) => filter.id !== "solution").map(
                (filter) => {
                  const active = filter.id === kind;
                  const Icon = filter.icon;
                  const colors = KIND_COLORS[filter.id];
                  return (
                    // eslint-disable-next-line react/forbid-elements -- tab pill styled by dynamic per-kind tint classes; kit ghost hover styles would override the active tint
                    <button
                      key={filter.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => selectCatalogKind(filter.id)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                        active ? colors.tabActive : colors.tabIdle,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {filter.label}
                    </button>
                  );
                },
              )}
            </div>
          </div>
        </section>
      )}

      {catalog.isLoading ? (
        <EmptyState icon={<Package />} title="Loading store catalog..." />
      ) : items.length === 0 && solutions.length === 0 ? (
        <EmptyState icon={<Package />} title="No store items found" />
      ) : kind === "solution" &&
        filteredSolutions.length === 0 &&
        filteredBlueprints.length === 0 ? (
        <EmptyState icon={<Package />} title="No matching solutions" />
      ) : kind !== "solution" && filtered.length === 0 ? (
        <EmptyState icon={<Package />} title="No matching store items" />
      ) : (
        <div className="space-y-8">
          {kind === "solution" ? (
            <>
              <section
                aria-labelledby="store-group-blueprints"
                className="space-y-4"
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="store-group-blueprints"
                      className="text-lg font-semibold text-foreground"
                    >
                      Strategy Blueprints
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Apply a complete outcome and let Kody adapt it to this
                      repository.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                      {filteredBlueprints.length}
                    </span>
                    <Button
                      size="sm"
                      onClick={() =>
                        startFlow(
                          CREATE_BLUEPRINT_FLOW_ID,
                          "request-blueprint:create-blueprint",
                        )
                      }
                    >
                      <Play className="mr-1.5 h-4 w-4" />
                      Create Blueprint
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {filteredBlueprints.map((item) => (
                    <CatalogCard
                      key={`${item.kind}:${item.slug}`}
                      item={item}
                      onSelect={() => selectCatalogItem(item)}
                    />
                  ))}
                </div>
              </section>
              <section
                aria-labelledby="store-group-solutions"
                className="space-y-4"
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="store-group-solutions"
                      className="text-lg font-semibold text-foreground"
                    >
                      Solutions
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Complete setups ready to review and install.
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                    {filteredSolutions.length}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {filteredSolutions.map((solution) => (
                    <SolutionCard
                      key={solution.slug}
                      solution={solution}
                      onSelect={() => selectSolution(solution)}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : null}
          {kind !== "solution"
            ? grouped.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section
                    key={group.id}
                    aria-labelledby={`store-group-${group.id}`}
                    className="space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <GroupIcon
                          className={cn("h-4 w-4", KIND_COLORS[group.id].icon)}
                        />
                        <h2
                          id={`store-group-${group.id}`}
                          className="text-sm font-semibold text-foreground"
                        >
                          {group.label}
                        </h2>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      {group.items.map((item) => (
                        <CatalogCard
                          key={`${item.kind}:${item.slug}`}
                          item={item}
                          onSelect={() => selectCatalogItem(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            : null}
        </div>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) selectCatalogItem(null);
        }}
      >
        {selected ? (
          <CatalogDetail
            item={selected}
            onInstall={() => installMutation.mutate(selected)}
            onUninstall={() => uninstallMutation.mutate(selected)}
            onApply={() => blueprintMutation.mutate(selected)}
            busy={
              (pendingStoreItemKey === storeCatalogItemKey(selected) &&
                (installMutation.isPending || uninstallMutation.isPending)) ||
              (blueprintMutation.variables
                ? storeCatalogItemKey(blueprintMutation.variables) ===
                    storeCatalogItemKey(selected) && blueprintMutation.isPending
                : false)
            }
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!selectedSolution}
        onOpenChange={(open) => {
          if (!open) selectSolution(null);
        }}
      >
        {selectedSolution ? (
          <SolutionDetail
            solution={selectedSolution}
            busy={solutionMutation.isPending}
            onChange={(remove) =>
              solutionMutation.mutate({
                solution: selectedSolution,
                remove,
              })
            }
          />
        ) : null}
      </Dialog>
    </PageShell>
  );
}

function countSolutionNodes(nodes: StoreSolutionNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countSolutionNodes(node.children),
    0,
  );
}

function SolutionCard({
  solution,
  onSelect,
}: {
  solution: StoreSolution;
  onSelect: () => void;
}) {
  const statusLabel =
    solution.status === "installed"
      ? "Installed"
      : solution.status === "partial"
        ? "Partially installed"
        : "Available";
  return (
    // eslint-disable-next-line react/forbid-elements -- interactive multi-line Store card needs semantic button behavior without kit button's single-line layout
    <button
      type="button"
      onClick={onSelect}
      data-testid={`store-solution-row-${solution.slug}`}
      className="group flex min-h-52 flex-col rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">
          <Package className="h-5 w-5" />
        </span>
        <span
          className={cn(
            "rounded-md border px-2 py-1 text-xs font-medium",
            solution.status === "installed"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100"
              : solution.status === "partial"
                ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
                : "border-border bg-background/50 text-muted-foreground",
          )}
        >
          {statusLabel}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">
        {solution.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {solution.description}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-xs text-muted-foreground">
        <span>{countSolutionNodes(solution.tree)} included items</span>
        <span className="font-medium text-emerald-700 dark:text-emerald-200">
          View solution
        </span>
      </div>
    </button>
  );
}

function SolutionDetail({
  solution,
  busy,
  onChange,
}: {
  solution: StoreSolution;
  busy: boolean;
  onChange: (remove: boolean) => void;
}) {
  const installed = solution.status === "installed";
  const statusLabel = installed
    ? "Installed"
    : solution.status === "partial"
      ? "Partially installed"
      : "Available";

  return (
    <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-border bg-card text-card-foreground">
      <DialogHeader className="shrink-0 pr-8">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100">
            <Package className="h-4 w-4" />
          </span>
          <DialogTitle className="truncate text-xl text-foreground">
            {solution.title}
          </DialogTitle>
        </div>
        <DialogDescription className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{solution.slug}</span>
          <span className="font-medium text-emerald-700 dark:text-emerald-100">
            Solution
          </span>
          <span>{statusLabel}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <section className="rounded-md border border-border bg-emerald-500/5 p-4">
              <h3 className="text-sm font-medium text-foreground">
                What this Solution does
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {solution.description}
              </p>
              <p className="mt-3 text-sm text-foreground/80">
                Installing it also installs every dependency shown below.
              </p>
            </section>
            <section className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">
                Complete setup
              </h3>
              <div className="overflow-hidden rounded-md border border-border bg-background/40">
                <DependencyTree nodes={solution.tree} />
              </div>
            </section>
          </div>

          <aside className="space-y-3">
            <InfoRow label="Type" value="Solution" />
            <InfoRow
              label="Included"
              value={`${countSolutionNodes(solution.tree)} items`}
            />
            <InfoRow label="Status" value={statusLabel} />
            <InfoRow label="Source">
              <a
                href={solution.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Store source</span>
              </a>
            </InfoRow>
          </aside>
        </div>
      </div>

      <div className="flex shrink-0 justify-end border-t border-border pt-3">
        <Button
          size="sm"
          onClick={() => onChange(installed)}
          disabled={busy}
          variant={installed ? "outline" : "default"}
          data-testid={`store-catalog-import-solution-${solution.slug}`}
          className="gap-1"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : installed ? (
            <Trash2 className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {busy
            ? "Working..."
            : installed
              ? "Remove entry points"
              : solution.status === "partial"
                ? "Complete install"
                : "Install solution"}
        </Button>
      </div>
    </DialogContent>
  );
}

function DependencyTree({
  nodes,
  depth = 0,
}: {
  nodes: StoreSolutionNode[];
  depth?: number;
}) {
  return (
    <ul className={cn(depth > 0 && "ml-5 border-l border-border")}>
      {nodes.map((node) => {
        const Icon =
          node.kind === "loop"
            ? Clock3
            : node.kind === "trigger"
              ? Zap
              : node.kind === "workflow"
                ? Workflow
                : node.kind === "agent"
                  ? Users
                  : Layers;
        return (
          <li key={`${node.kind}:${node.slug}`}>
            <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3 md:px-4">
              <Icon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {node.title}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {node.slug}
                </div>
              </div>
              <span className="text-[11px] capitalize text-muted-foreground">
                {node.kind}
              </span>
              {node.installed ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-500"
                  aria-label="Installed"
                />
              ) : null}
            </div>
            {node.children.length > 0 ? (
              <DependencyTree nodes={node.children} depth={depth + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CatalogCard({
  item,
  onSelect,
}: {
  item: StoreCatalogItem;
  onSelect: () => void;
}) {
  const Icon = displayKindIcon(item);
  const colors = displayKindColor(item);
  const uninstallBlocked = (item.uninstallBlockedBy ?? []).length > 0;
  return (
    // eslint-disable-next-line react/forbid-elements -- clickable multi-line card row; kit button base styles (nowrap/centering) would break its layout
    <button
      type="button"
      onClick={onSelect}
      data-testid={`store-catalog-row-${item.kind}-${item.slug}`}
      className={cn(
        "group min-h-[6.25rem] w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted/30",
        colors.borderHover,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border transition-colors",
            colors.tint,
            colors.text,
            colors.iconHover,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium leading-5 text-foreground">
            {item.title || item.slug}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
            {item.slug}
          </span>
        </div>
      </div>
      {item.description ? (
        <p className="mt-2 line-clamp-1 text-xs leading-5 text-muted-foreground">
          {item.description}
        </p>
      ) : null}
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-md border border-current/20 px-1.5 py-0.5 text-[11px]",
            colors.tint,
            colors.text,
          )}
        >
          {displayKindLabel(item)}
        </span>
        {item.installed ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-100">
            <CheckCircle2 className="h-3 w-3" />
            Installed
          </span>
        ) : (
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            Available
          </span>
        )}
        {item.installed && uninstallBlocked ? (
          <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-100">
            In use
          </span>
        ) : null}
      </div>
    </button>
  );
}

function CatalogDetail({
  item,
  onInstall,
  onUninstall,
  onApply,
  busy,
}: {
  item: StoreCatalogItem;
  onInstall: () => void;
  onUninstall: () => void;
  onApply: () => void;
  busy: boolean;
}) {
  const Icon = displayKindIcon(item);
  const colors = displayKindColor(item);
  const installed = item.installed === true;
  const blockers = item.uninstallBlockedBy ?? [];
  const uninstallBlocked = installed && blockers.length > 0;
  const statusLabel = installed
    ? uninstallBlocked
      ? "Installed, in use"
      : "Installed"
    : "Available";
  const sourceLabel = item.htmlUrl ? "Store source" : "Store catalog";

  return (
    <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-border bg-card text-card-foreground">
      <DialogHeader className="shrink-0 pr-8">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-current/20",
              colors.tint,
              colors.text,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <DialogTitle className="truncate text-xl text-foreground">
            {item.title || item.slug}
          </DialogTitle>
        </div>
        <DialogDescription className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{item.slug}</span>
          <span className={cn("font-medium", colors.text)}>
            {displayKindLabel(item)}
          </span>
          <span className="text-muted-foreground">{statusLabel}</span>
          {installed ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-100">
              <CheckCircle2 className="h-3 w-3" />
              Installed
            </span>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            {item.description ? (
              <section className="rounded-md border border-border bg-muted/20 p-4">
                <h3 className="text-sm font-medium text-foreground">Summary</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </section>
            ) : null}

            {item.kind === "blueprint" && item.blueprint ? (
              <section className="space-y-3 rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 p-4">
                <h3 className="text-sm font-medium text-foreground">
                  What Kody is allowed to do
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {item.blueprint.constraints.map((constraint) => (
                    <li key={constraint}>{constraint}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Apply also installs Kody's repository launcher when it is
                  missing. Kody then works through the saved Todo until the
                  verification below passes or a real decision needs you.
                </p>
              </section>
            ) : null}

            {uninstallBlocked ? (
              <section className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-100">
                <h3 className="font-medium">Required by</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {blockers.map((blocker) => (
                    <span
                      key={`${blocker.kind}:${blocker.slug}`}
                      className="rounded-md border border-current/20 bg-background/40 px-2 py-1 text-xs"
                    >
                      {blocker.title || blocker.slug}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-3">
            <InfoRow label="Type" value={displayKindLabel(item)} />
            <InfoRow label="Slug" value={item.slug} mono />
            <InfoRow label="Status" value={statusLabel} />
            {item.blueprint ? (
              <>
                <InfoRow label="Version" value={item.blueprint.version} />
                <InfoRow
                  label="Works with"
                  value={[
                    ...item.blueprint.repositoryTypes,
                    ...item.blueprint.providers,
                  ].join(", ")}
                />
                <InfoRow
                  label="Done when"
                  value={item.blueprint.verification.join("; ")}
                />
              </>
            ) : null}
            <InfoRow label="Source">
              {item.htmlUrl ? (
                <a
                  href={item.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-foreground underline-offset-4 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{sourceLabel}</span>
                </a>
              ) : (
                sourceLabel
              )}
            </InfoRow>
          </aside>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-3">
        {item.htmlUrl ? (
          <Button asChild size="sm" variant="outline" className="gap-1">
            <a href={item.htmlUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={
            item.kind === "blueprint"
              ? onApply
              : installed
                ? onUninstall
                : onInstall
          }
          disabled={busy || uninstallBlocked}
          data-testid={`store-catalog-import-${item.kind}-${item.slug}`}
          variant={installed ? "outline" : "default"}
          className="gap-1"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : item.kind === "blueprint" ? (
            <Play className="h-4 w-4" />
          ) : installed ? (
            <Trash2 className="h-4 w-4" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {busy
            ? installed
              ? "Uninstalling..."
              : item.kind === "blueprint"
                ? "Starting..."
                : "Installing..."
            : item.kind === "blueprint"
              ? "Apply Blueprint"
              : installed
                ? "Uninstall"
                : "Install"}
        </Button>
      </div>
    </DialogContent>
  );
}

function InfoRow({
  label,
  value,
  children,
  mono = false,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {children ?? value}
      </span>
    </div>
  );
}
