/**
 * @fileType component
 * @domain instructions
 * @pattern system-prompt-override-card
 * @ai-summary Editor card for backend `system-prompt.md` — the per-repo
 *   BASE system prompt override for engine chat (kody-live). Unlike
 *   instructions.md (layered on top), a non-empty file REPLACES the
 *   engine's built-in prompt, including its tool-usage and grounding
 *   rules. Rendered below the shared InstructionsManager page.
 */
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Label } from "@kody-ade/base/ui/label";
import { Textarea } from "@kody-ade/base/ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuth, buildAuthHeaders } from "../auth-context";
import { ENGINE_DEFAULT_SYSTEM_PROMPT } from "../system-prompt/engine-default";

interface SystemPromptResource {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const queryKey = (owner?: string | null, repo?: string | null) =>
  ["kody-system-prompt", owner ?? null, repo ?? null] as const;

async function fetchSystemPrompt(
  headers: Record<string, string>,
): Promise<SystemPromptResource | null> {
  const res = await fetch("/api/kody/system-prompt", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    systemPrompt?: SystemPromptResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.systemPrompt ?? null;
}

async function saveSystemPrompt(
  headers: Record<string, string>,
  body: string,
  sha?: string,
): Promise<SystemPromptResource | null> {
  const res = await fetch("/api/kody/system-prompt", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body, sha }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    systemPrompt?: SystemPromptResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.systemPrompt ?? null;
}

export function SystemPromptOverrideCard() {
  const { auth } = useAuth();
  const headers = buildAuthHeaders(auth);
  const queryClient = useQueryClient();
  const key = queryKey(auth?.owner, auth?.repo);

  const { data: file, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchSystemPrompt(headers),
    enabled: Boolean(auth),
  });

  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  // No saved override → start from the engine's real default prompt so the
  // user edits the actual text instead of a blank box.
  const baseline = file?.body ?? ENGINE_DEFAULT_SYSTEM_PROMPT;
  useEffect(() => {
    setDraft(baseline);
  }, [file?.sha, baseline]);

  const dirty = draft !== baseline;

  const mutation = useMutation({
    mutationFn: (body: string) => saveSystemPrompt(headers, body, file?.sha),
    onSuccess: (saved) => {
      queryClient.setQueryData(key, saved);
      toast.success(
        saved
          ? "Base prompt override saved — engine chat now uses it instead of the built-in prompt."
          : "Override removed — engine chat is back on the built-in prompt.",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save the base prompt override");
    },
  });

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1">
          <Label htmlFor="system-prompt-override">
            Base system prompt override (engine chat)
          </Label>
          <p className="text-sm text-muted-foreground">
            The base prompt engine chat (kody-live) runs with. Shown below is{" "}
            {file
              ? "your saved override — the engine uses it instead of its built-in prompt."
              : "the engine's built-in default — edit and save to override it."}{" "}
            &quot;Remove override&quot; returns to the built-in. Instructions
            above are layered on top either way.
          </p>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Textarea
            id="system-prompt-override"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Empty — the engine's built-in system prompt is in use. Paste a full replacement prompt here to override it."
            className="min-h-[240px] font-mono text-sm"
          />
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate(draft)}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save override
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || mutation.isPending}
            onClick={() => setDraft(baseline)}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Revert
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={!file || mutation.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove override
          </Button>
        </div>
        <ConfirmDialog
          open={confirmClear}
          title="Remove the base prompt override?"
          description="Engine chat immediately goes back to the built-in system prompt."
          confirmLabel="Remove"
          variant="destructive"
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            mutation.mutate("");
          }}
        />
      </CardContent>
    </Card>
  );
}
