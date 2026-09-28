"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Loader2, Pencil, Plus, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "./PageShell";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Checkbox } from "@kody-ade/base/ui/checkbox";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import type { BrainChatModel } from "@kody-ade/brain/chat-models";

const queryKey = ["brain-chat-models"] as const;

function modelId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function fetchModels() {
  const response = await fetch("/api/kody/brain/models", {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    models?: BrainChatModel[];
    message?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      body.message || body.error || "Could not load Brain models",
    );
  return body.models ?? [];
}

async function saveModels(models: BrainChatModel[]) {
  const response = await fetch("/api/kody/brain/models", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      body.message || body.error || "Could not save Brain models",
    );
}

export function BrainModelsManager() {
  return <BrainModelsManagerInner />;
}

function BrainModelsManagerInner() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BrainChatModel | null>(null);
  const [draft, setDraft] = useState({ name: "", runtime: "" });
  const modelsQuery = useQuery({
    queryKey,
    queryFn: fetchModels,
  });
  const models = modelsQuery.data ?? [];
  const save = useMutation({
    mutationFn: saveModels,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      setEditing(null);
      setDraft({ name: "", runtime: "" });
      toast.success("Brain model saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openNew = () => {
    setEditing(null);
    setDraft({ name: "", runtime: "" });
  };

  const openEdit = (model: BrainChatModel) => {
    setEditing(model);
    setDraft({ name: model.name, runtime: model.runtime });
  };

  const submit = () => {
    const name = draft.name.trim();
    const runtime = draft.runtime.trim();
    if (!name || !runtime) return;
    const nextModel: BrainChatModel = {
      id: editing?.id || modelId(name),
      name,
      runtime,
      enabled: editing?.enabled ?? true,
      default: editing?.default ?? models.length === 0,
    };
    const next = editing
      ? models.map((model) => (model.id === editing.id ? nextModel : model))
      : [...models, nextModel];
    const defaultId = nextModel.default
      ? nextModel.id
      : next.find((model) => model.default)?.id;
    save.mutate(
      next.map((model) => ({ ...model, default: model.id === defaultId })),
    );
  };

  const setDefault = (id: string) => {
    save.mutate(
      models.map((model) => ({ ...model, default: model.id === id })),
    );
  };

  const toggle = (id: string) => {
    save.mutate(
      models.map((model) =>
        model.id === id ? { ...model, enabled: !model.enabled } : model,
      ),
    );
  };

  const remove = (id: string) => {
    save.mutate(models.filter((model) => model.id !== id));
  };

  return (
    <PageShell
      title="Brain"
      icon={Brain}
      iconClassName="text-violet-400"
      subtitle="Personal Brain chat models"
      actions={
        <Button size="sm" onClick={openNew} className="gap-1">
          <Plus className="h-4 w-4" /> New model
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/55">
          Add a name and the command that starts this Brain model. The command
          runs in your personal Brain runtime.
        </p>

        {(editing || (!modelsQuery.isLoading && models.length === 0)) && (
          <Card className="border-violet-500/20 bg-violet-950/10">
            <CardContent className="space-y-3 p-4">
              <div>
                <Label htmlFor="brain-model-name">Name</Label>
                <Input
                  id="brain-model-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Personal Brain"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="brain-model-runtime">Runtime command</Label>
                <Input
                  id="brain-model-runtime"
                  value={draft.runtime}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      runtime: event.target.value,
                    }))
                  }
                  placeholder="codex app-server"
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                {editing && (
                  <Button variant="ghost" size="sm" onClick={openNew}>
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={
                    save.isPending ||
                    !draft.name.trim() ||
                    !draft.runtime.trim()
                  }
                  className="gap-1"
                >
                  {save.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {editing ? "Save" : "Add"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {modelsQuery.isLoading && (
          <p className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {modelsQuery.error && (
          <p className="text-sm text-rose-300">
            {(modelsQuery.error as Error).message}
          </p>
        )}

        <ul className="space-y-2">
          {models.map((model) => (
            <li key={model.id}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      checked={model.enabled}
                      onCheckedChange={() => toggle(model.id)}
                      aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                        <span className="truncate">{model.name}</span>
                        {model.default && (
                          <Star
                            className="h-3.5 w-3.5 text-amber-300"
                            aria-label="Default"
                          />
                        )}
                      </div>
                      <p className="truncate font-mono text-[11px] text-white/45">
                        {model.runtime}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!model.default && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDefault(model.id)}
                      >
                        Default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(model)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-300"
                      onClick={() => remove(model.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
