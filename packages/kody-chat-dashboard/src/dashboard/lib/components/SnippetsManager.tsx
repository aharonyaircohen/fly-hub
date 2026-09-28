/**
 * @fileType component
 * @domain snippets
 * @pattern snippets-manager
 * @ai-summary CRUD UI for brand snippets — named script/HTML blocks kody
 *   injects into brand pages server-side (analytics tags, widgets, pixels;
 *   kody stays vendor-neutral). Follows the standard admin-page structure:
 *   PageShell + card rows with status icon and Power toggle + ui-kit
 *   dialog editor.
 */
"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleDot,
  Code2,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kody-ade/base/ui/select";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  { ssr: false, loading: () => null },
);
import { slugifyTitle } from "@kody-ade/base/slug";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { PageShell } from "./PageShell";

interface SnippetRow {
  id: string;
  name: string;
  enabled: boolean;
  placement: "body-start" | "body-end";
  html: string;
}

const PLACEMENTS: Array<{ value: SnippetRow["placement"]; label: string }> = [
  { value: "body-start", label: "Page start (loads first)" },
  { value: "body-end", label: "Page end" },
];

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(json.detail || json.error || `HTTP ${res.status}`);
  }
  return json;
}

interface EditorState {
  id: string;
  name: string;
  enabled: boolean;
  placement: SnippetRow["placement"];
  html: string;
  isNew: boolean;
}

export function SnippetsManager() {
  const { auth } = useAuth();
  const headers = useMemo(
    () => ({ "content-type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const queryClient = useQueryClient();
  const queryKey = ["kody-snippets", auth?.owner, auth?.repo] as const;

  const snippetsQuery = useQuery({
    queryKey,
    enabled: !!auth,
    queryFn: () =>
      fetchJson<{ snippets: SnippetRow[] }>("/api/kody/snippets", headers).then(
        (json) => json.snippets ?? [],
      ),
  });

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnippetRow | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const saveMutation = useMutation({
    mutationFn: (state: EditorState) =>
      fetchJson("/api/kody/snippets", headers, {
        method: "POST",
        body: JSON.stringify({
          snippet: {
            id: state.isNew ? slugifyTitle(state.name) : state.id,
            name: state.name.trim(),
            enabled: state.enabled,
            placement: state.placement,
            html: state.html,
          },
        }),
      }),
    onSuccess: () => {
      toast.success("Snippet saved");
      setEditor(null);
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (snippet: SnippetRow) =>
      fetchJson("/api/kody/snippets", headers, {
        method: "POST",
        body: JSON.stringify({
          snippet: { ...snippet, enabled: !snippet.enabled },
        }),
      }),
    onSuccess: () => void invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/kody/snippets/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      }).then((res) => {
        if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      }),
    onSuccess: () => {
      toast.success("Snippet deleted");
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const snippets = snippetsQuery.data ?? [];

  return (
    <PageShell
      title="Snippets"
      icon={Code2}
      subtitle="Scripts and HTML injected into brand pages — analytics tags, widgets, pixels."
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void invalidate()}
            disabled={snippetsQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${snippetsQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            size="sm"
            disabled={!auth}
            onClick={() =>
              setEditor({
                id: "",
                name: "",
                enabled: true,
                placement: "body-start",
                html: "",
                isNew: true,
              })
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> New snippet
          </Button>
        </>
      }
    >
      {snippetsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : snippets.length === 0 ? (
        <EmptyState
          icon={<Code2 />}
          title="No snippets yet"
          hint="Paste the tag your analytics or widget vendor gives you — kody injects it on brand pages."
        />
      ) : (
        <div className="space-y-2">
          {snippets.map((snippet) => (
            <Card key={snippet.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {snippet.enabled ? (
                    <CircleDot className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <PowerOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium">{snippet.name}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {snippet.placement} ·{" "}
                      <code>{snippet.html.slice(0, 60)}</code>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={snippet.enabled ? "Disable" : "Enable"}
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate(snippet)}
                  >
                    <Power
                      className={`h-4 w-4 ${
                        snippet.enabled
                          ? "text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditor({ ...snippet, isNew: false })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(snippet)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent modalSize="wide">
          <DialogHeader>
            <DialogTitle>
              {editor?.isNew ? "New snippet" : "Edit snippet"}
            </DialogTitle>
            <DialogDescription>
              The snippet is injected verbatim into brand pages.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="snippet-name">Name</Label>
                  <Input
                    id="snippet-name"
                    value={editor.name}
                    placeholder="Analytics tag"
                    onChange={(e) =>
                      setEditor({ ...editor, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Placement</Label>
                  <Select
                    value={editor.placement}
                    onValueChange={(value) =>
                      setEditor({
                        ...editor,
                        placement: value as SnippetRow["placement"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLACEMENTS.map((placement) => (
                        <SelectItem
                          key={placement.value}
                          value={placement.value}
                        >
                          {placement.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Snippet (HTML / script)</Label>
                <div className="overflow-hidden rounded-md border border-border">
                  <MonacoEditor
                    height="280px"
                    language="html"
                    value={editor.html}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      wordWrap: "on",
                      automaticLayout: true,
                    }}
                    onChange={(value) =>
                      setEditor({ ...editor, html: value ?? "" })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => saveMutation.mutate(editor)}
                  disabled={
                    saveMutation.isPending ||
                    !editor.name.trim() ||
                    !editor.html.trim()
                  }
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete snippet?"
        description={`"${deleteTarget?.name}" will stop loading on brand pages.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </PageShell>
  );
}
