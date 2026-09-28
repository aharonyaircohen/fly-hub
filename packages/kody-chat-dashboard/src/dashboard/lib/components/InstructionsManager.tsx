/**
 * @fileType component
 * @domain instructions
 * @pattern instructions-manager
 * @ai-summary Editor for backend `instructions.md` — the per-repo user
 *   instructions appended to every kody-direct chat turn — plus the base
 *   system prompt override card (backend `system-prompt.md`) rendered
 *   below it.
 */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  RotateCcw,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { PageShell } from "./PageShell";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Label } from "@kody-ade/base/ui/label";
import { Textarea } from "@kody-ade/base/ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import { SystemPromptOverrideCard } from "./SystemPromptOverrideCard";
import { useAuth, buildAuthHeaders } from "../auth-context";

interface InstructionsResource {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface InstructionsQueryScope {
  owner?: string | null;
  repo?: string | null;
}

function instructionsQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): InstructionsQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const instructionsQueryKeys = {
  all: ["kody-instructions"] as const,
  file: (scope: InstructionsQueryScope = {}) =>
    ["kody-instructions", scope.owner ?? null, scope.repo ?? null] as const,
  basePrompt: (scope: InstructionsQueryScope = {}) =>
    [
      "kody-instructions-base",
      scope.owner ?? null,
      scope.repo ?? null,
    ] as const,
  fullPrompt: (scope: InstructionsQueryScope = {}) =>
    [
      "kody-instructions-full",
      scope.owner ?? null,
      scope.repo ?? null,
    ] as const,
};

async function fetchInstructions(
  headers: Record<string, string>,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.instructions ?? null;
}

async function saveInstructions(
  headers: Record<string, string>,
  body: string,
  sha: string | undefined,
  actorLogin: string | undefined,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", {
    method: "PUT",
    headers,
    body: JSON.stringify({ body, sha, actorLogin }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.instructions ?? null;
}

async function deleteInstructions(
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch("/api/kody/instructions", {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export interface InstructionsManagerProps {
  /**
   * Optional host-provided section rendered inside the page's scroll area,
   * below the instructions editor (e.g. the dashboard's base system prompt
   * override card). Content outside PageShell is invisible — the shell owns
   * the page scroll — so hosts must inject through this slot.
   */
  footerSlot?: ReactNode;
}

export function InstructionsManager({ footerSlot }: InstructionsManagerProps) {
  return <InstructionsManagerInner footerSlot={footerSlot} />;
}

function InstructionsManagerInner({ footerSlot }: InstructionsManagerProps) {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const queryScope = instructionsQueryScopeFromAuth(auth);
  const fileQueryKey = instructionsQueryKeys.file(queryScope);

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } =
    useQuery<InstructionsResource | null>({
      queryKey: fileQueryKey,
      queryFn: () => fetchInstructions(headers),
      enabled: true,
      staleTime: 30_000,
    });

  const [draft, setDraft] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.body);
    else if (data === null) setDraft("");
  }, [data]);

  const dirty = useMemo(() => draft !== (data?.body ?? ""), [draft, data]);

  const save = useMutation({
    mutationFn: () => saveInstructions(headers, draft, data?.sha, actorLogin),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: instructionsQueryKeys.all });
      queryClient.setQueryData(fileQueryKey, res);
      toast.success("Instructions saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save instructions"),
  });

  const remove = useMutation({
    mutationFn: () => deleteInstructions(headers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: instructionsQueryKeys.all });
      queryClient.setQueryData(fileQueryKey, null);
      setDraft("");
      toast.success("Instructions removed");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete instructions"),
  });

  return (
    <PageShell
      title="Instructions"
      icon={ScrollText}
      iconClassName="text-cyan-300"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          {data?.htmlUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link
                href={data.htmlUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View on GitHub"
              >
                <ExternalLink className="w-4 h-4" />
                On GitHub
              </Link>
            </Button>
          )}
          {data && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-rose-300 hover:text-rose-200"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60">
          Free-form markdown appended to every chat turn for the in-process Kody
          agent. Use it to set tone, length, formatting, or behavioral
          preferences for {auth ? "this repository" : "your Kody account"}.
        </p>

        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading instructions…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load instructions
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-1"
                onClick={() => refetch()}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && (
          <div className="space-y-3">
            <Label
              htmlFor="instructions-body"
              className="text-sm text-white/70"
            >
              Instructions
            </Label>
            <Textarea
              id="instructions-body"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Default to one-sentence answers. Always cite file paths when referencing code. Prefer Tailwind over inline styles."
              className="min-h-[320px] font-mono text-sm"
            />
            <p className="pt-1 text-[11px] text-white/30">
              {data?.updatedAt
                ? `Last saved ${formatRelative(data.updatedAt)}.`
                : "Not saved yet."}{" "}
              Hard rules in the base agent prompt (never fake tool calls,
              research before evaluating) still win over your instructions.
            </p>
          </div>
        )}

        <SystemPromptOverrideCard />
        {footerSlot}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove instructions?"
        description="The backend instructions.md file will be deleted. Chat falls back to the base agent prompt only."
        confirmLabel={remove.isPending ? "Removing…" : "Remove"}
        variant="destructive"
        onConfirm={() => {
          remove.mutate();
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </PageShell>
  );
}
