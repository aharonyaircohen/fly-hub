/**
 * @fileType component
 * @domain widgets
 * @pattern backend-manager
 * @ai-summary Admin UI for the tenant's widget store: lists the latest
 *   published version per slug (metadata only) and publishes new bundle
 *   versions via an upload dialog (paste or file picker). Bundles are
 *   per-tenant data served by /api/kody/widgets/<slug>.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Blocks, Loader2, Play, Trash2, Upload } from "lucide-react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { cn } from "../utils";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { Textarea } from "@kody-ade/base/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { requestWidgetOpen } from "../widgets/chat-launch";
import { widgetSlugFromName } from "../widgets/identity";
import { selectionPath } from "../selection-routing";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";

/** Convex documents cap at ~1MB — mirror the API route's bundle cap. */
const MAX_BUNDLE_CHARS = 900_000;

interface WidgetRow {
  tenantId: string;
  name: string;
  slug: string;
  version: number;
  bundleSize: number;
  commitSha?: string;
  updatedAt: string;
}

interface WidgetQueryScope {
  owner?: string | null;
  repo?: string | null;
}

const widgetQueryKeys = {
  all: ["widgets"] as const,
  list: (scope: WidgetQueryScope = {}) =>
    ["widgets", scope.owner ?? null, scope.repo ?? null] as const,
};

function formatBundleSize(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)} MB`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)} KB`;
  return `${chars} B`;
}

function formatUpdatedAt(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString();
}

async function listWidgetsApi(
  headers: Record<string, string>,
): Promise<WidgetRow[]> {
  const res = await fetch("/api/kody/widgets", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    widgets?: WidgetRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.widgets) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.widgets;
}

async function publishWidgetApi(
  headers: Record<string, string>,
  input: { name: string; bundle: string; commitSha?: string },
): Promise<{ name: string; slug: string; version: number }> {
  const res = await fetch("/api/kody/widgets", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    slug?: string;
    version?: number;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.name || !json.slug || typeof json.version !== "number") {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return { name: json.name, slug: json.slug, version: json.version };
}

async function deleteWidgetApi(
  headers: Record<string, string>,
  slug: string,
): Promise<void> {
  const res = await fetch(`/api/kody/widgets/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export function WidgetsManager({ initialSlug }: { initialSlug?: string }) {
  return <WidgetsManagerInner initialSlug={initialSlug} />;
}

function WidgetsManagerInner({ initialSlug }: { initialSlug?: string }) {
  const { auth } = useAuth();
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const headers = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...buildAuthHeaders(auth),
    }),
    [auth],
  );
  const queryClient = useQueryClient();
  const listQueryKey = widgetQueryKeys.list({
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  });
  const [search, setSearch] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    initialSlug ?? null,
  );
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<WidgetRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listWidgetsApi(headers),
    enabled: true,
    staleTime: 30_000,
  });
  const widgets = useMemo(() => data ?? [], [data]);
  const selected = selectedSlug
    ? (widgets.find((widget) => widget.slug === selectedSlug) ?? null)
    : null;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return widgets;
    return widgets.filter((widget) =>
      [widget.name, widget.slug, widget.commitSha ?? "", `v${widget.version}`]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [widgets, search]);

  useEffect(() => {
    setSelectedSlug(initialSlug ?? null);
  }, [initialSlug]);

  const publish = useMutation({
    mutationFn: (input: { name: string; bundle: string; commitSha?: string }) =>
      publishWidgetApi(headers, input),
    onSuccess: async (result) => {
      setUploadOpen(false);
      setSelectedSlug(result.slug);
      router.replace(scopedHref(selectionPath("/views/widgets", result.slug)));
      await queryClient.invalidateQueries({ queryKey: widgetQueryKeys.all });
      toast.success(`Published ${result.name} v${result.version}`);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to publish"),
  });
  const remove = useMutation({
    mutationFn: (slug: string) => deleteWidgetApi(headers, slug),
    onSuccess: async () => {
      setSelectedSlug(null);
      router.replace(scopedHref("/views/widgets"));
      await queryClient.invalidateQueries({ queryKey: widgetQueryKeys.all });
      toast.success("Widget deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete"),
  });

  const uploadAction = (
    <Button
      variant="outline"
      size="sm"
      className="h-8 w-8 px-0"
      title="Upload widget"
      aria-label="Upload widget"
      onClick={() => setUploadOpen(true)}
    >
      <Upload className="h-3.5 w-3.5" />
    </Button>
  );

  const detail = selected ? (
    <WidgetDetail
      widget={selected}
      deleting={remove.isPending}
      onDelete={() => {
        if (window.confirm(`Delete ${selected.name} and all its versions?`)) {
          remove.mutate(selected.slug);
        }
      }}
    />
  ) : (
    <EmptyState
      icon={<Blocks />}
      title="Select a widget"
      hint="Pick a widget to see its latest published version."
    />
  );

  return (
    <div className="h-full">
      <MasterDetailShell
        title="Widgets"
        icon={Blocks}
        iconClassName="text-cyan-300"
        subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search widgets..."
        searchAriaLabel="Search widgets"
        accent="teal"
        hasSelection={Boolean(selected)}
        detail={detail}
        actions={uploadAction}
      >
        {isLoading ? (
          <EmptyState
            icon={<Loader2 className="animate-spin" />}
            title="Loading widgets..."
          />
        ) : error ? (
          <EmptyState
            icon={<Blocks />}
            title="Could not load widgets"
            hint={error instanceof Error ? error.message : "Unknown error"}
            action={
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Blocks />}
            title={widgets.length === 0 ? "No widgets yet" : "No matches"}
            hint={
              widgets.length === 0
                ? `Widgets are precompiled JS bundles published to ${auth ? "this repository" : "your Kody account"}. Upload the first bundle to make it available in Chat.`
                : "Try another search."
            }
            action={
              widgets.length === 0 ? (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="h-4 w-4" />
                  Upload widget
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((widget) => {
              const isActive = selectedSlug === widget.slug;
              return (
                <li key={widget.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSlug(widget.slug);
                      router.push(
                        scopedHref(
                          selectionPath("/views/widgets", widget.slug),
                        ),
                      );
                    }}
                    className={cn(
                      "relative w-full px-4 py-3 text-start transition-colors hover:bg-accent/50",
                      isActive && "bg-accent/70",
                    )}
                  >
                    {isActive ? (
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-cyan-300" />
                    ) : null}
                    <div className="flex items-start gap-2">
                      <Blocks className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white/90">
                          {widget.name}
                        </p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {widget.slug} · v{widget.version} ·{" "}
                          {formatBundleSize(widget.bundleSize)} ·{" "}
                          {formatUpdatedAt(widget.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <WidgetUploadDialog
          open={uploadOpen}
          isPublishing={publish.isPending}
          onOpenChange={setUploadOpen}
          onPublish={(input) => publish.mutate(input)}
        />
      </MasterDetailShell>
    </div>
  );
}

function WidgetDetail({
  widget,
  deleting,
  onDelete,
}: {
  widget: WidgetRow;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white/90">
            {widget.name}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {widget.slug} · version {widget.version} · updated{" "}
            {formatUpdatedAt(widget.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Delete ${widget.name}`}
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            aria-label={`Play ${widget.name} in Chat`}
            onClick={() => requestWidgetOpen(widget.slug)}
          >
            <Play className="h-4 w-4" />
            Play in Chat
          </Button>
        </div>
      </div>

      <div className="px-4 py-5 md:px-6">
        <div className="mb-4 max-w-2xl rounded-md border border-white/[0.08] bg-black/20 p-4">
          <p className="text-sm font-medium text-white/85">Latest version</p>
          <dl className="mt-3 space-y-2 text-sm">
            <WidgetDetailRow label="Slug" value={widget.slug} />
            <WidgetDetailRow label="Version" value={`v${widget.version}`} />
            <WidgetDetailRow
              label="Bundle size"
              value={formatBundleSize(widget.bundleSize)}
            />
            <WidgetDetailRow
              label="Commit"
              value={widget.commitSha ? widget.commitSha.slice(0, 12) : "—"}
            />
            <WidgetDetailRow
              label="Updated"
              value={formatUpdatedAt(widget.updatedAt)}
            />
            <WidgetDetailRow
              label="Served from"
              value={`/api/kody/widgets/${widget.slug}`}
            />
          </dl>
        </div>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          Uploading a new bundle for this slug publishes the next version; chat
          surfaces pick it up on their next load. Earlier versions stay in the
          backend store for rollback.
        </p>
      </div>
    </div>
  );
}

function WidgetDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-mono text-xs text-white/85">{value}</dd>
    </div>
  );
}

function WidgetUploadDialog({
  open,
  isPublishing,
  onOpenChange,
  onPublish,
}: {
  open: boolean;
  isPublishing: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: (input: {
    name: string;
    bundle: string;
    commitSha?: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [bundle, setBundle] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const slug = widgetSlugFromName(name);
  const nameValid = name.trim().length > 0 && name.trim().length <= 120;
  const bundleValid = bundle.length > 0 && bundle.length <= MAX_BUNDLE_CHARS;
  const isValid = nameValid && Boolean(slug) && bundleValid;

  async function readBundleFile(file: File) {
    try {
      setBundle(await file.text());
      toast.success(`Loaded ${file.name}`);
    } catch {
      toast.error("Could not read the selected file.");
    }
  }

  function submit() {
    if (!isValid) return;
    const trimmedSha = commitSha.trim();
    onPublish({
      name: name.trim(),
      bundle,
      ...(trimmedSha ? { commitSha: trimmedSha } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Upload widget</DialogTitle>
          <DialogDescription>
            Publish a precompiled JS bundle as the next version of a widget for
            this Kody scope.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="widget-upload-name">Name</Label>
            <Input
              id="widget-upload-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quiz Card"
            />
            <p className="text-xs text-muted-foreground">
              Slug: <span className="font-mono">{slug || "—"}</span>
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="widget-upload-bundle">Bundle JS</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".js,.mjs,text/javascript"
                className="hidden"
                aria-label="Widget bundle file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readBundleFile(file);
                  event.target.value = "";
                }}
              />
            </div>
            <Textarea
              id="widget-upload-bundle"
              value={bundle}
              onChange={(event) => setBundle(event.target.value)}
              placeholder="Paste the compiled bundle JS, or choose a file."
              className="min-h-[28vh] font-mono text-xs leading-5"
              spellCheck={false}
            />
            <p
              className={cn(
                "text-xs",
                bundle.length > MAX_BUNDLE_CHARS
                  ? "text-rose-300"
                  : "text-muted-foreground",
              )}
            >
              {formatBundleSize(bundle.length)} of{" "}
              {formatBundleSize(MAX_BUNDLE_CHARS)} max.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="widget-upload-commit">Commit SHA (optional)</Label>
            <Input
              id="widget-upload-commit"
              value={commitSha}
              onChange={(event) => setCommitSha(event.target.value)}
              placeholder="abc1234"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="gap-1"
            disabled={!isValid || isPublishing}
            onClick={submit}
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Publish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
