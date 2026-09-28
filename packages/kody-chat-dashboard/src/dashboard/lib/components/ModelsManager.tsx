/**
 * @fileType component
 * @domain variables
 * @pattern models-manager
 * @ai-summary CRUD UI for the chat model list (LLM_MODELS variable).
 *   Scannable list view; the editor opens in a dialog with just the
 *   essentials surfaced — provider preset auto-fills baseURL/protocol,
 *   "Advanced" reveals internal id + URL + protocol for the `custom`
 *   provider case. The list drives the chat dropdown across the
 *   dashboard and /vibe; OpenRouter Free remains available when empty.
 */
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot,
  Cpu,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  Play,
  Plus,
  Save,
  Star,
  Trash2,
  Square,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { RepoScopedLink } from "./RepoScopedLink";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { Checkbox } from "@kody-ade/base/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kody-ade/base/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESET_IDS,
  type ChatAdapter,
  type ChatModel,
  type AutomaticModel,
  type ChatProtocol,
  type ProviderPreset,
} from "@kody-ade/base/variables/models";
import { buildAuthHeaders, useAuth } from "../auth-context";
import {
  KODY_BUILT_IN_CHAT_MODELS,
  composeChatModelCatalog,
} from "../chat/model-catalog";
import { TerminalSessionInputSchema } from "@kody-ade/terminal/terminal-session-model";
import {
  TerminalSessionClient,
  type TerminalClientSocket,
} from "../chat/plugins/terminal/terminal-session-client";

export const modelsQueryKeys = {
  all: ["kody-chat-models"] as const,
  list: (scopeOrLegacy?: "personal" | "repository" | unknown) => {
    const scope = scopeOrLegacy === "repository" ? "repository" : "personal";
    return ["kody-chat-models", scope] as const;
  },
};

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

async function fetchModels(
  headers: Record<string, string>,
  scope: "personal" | "repository",
): Promise<{ models: ChatModel[]; automatic: AutomaticModel }> {
  const endpoint =
    scope === "repository"
      ? "/api/kody/repository-models"
      : "/api/kody/models?scope=personal";
  const res = await fetch(endpoint, {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    models?: ChatModel[];
    automatic?: AutomaticModel;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return {
    models: json.models ?? [],
    automatic: json.automatic ?? { default: false, engineDefault: false },
  };
}

async function fetchEngineModels(
  headers: Record<string, string>,
): Promise<{ models: ChatModel[]; automatic: AutomaticModel }> {
  const res = await fetch("/api/kody/engine-models", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    models?: ChatModel[];
    automatic?: AutomaticModel;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return {
    models: json.models ?? [],
    automatic: json.automatic ?? { default: false, engineDefault: false },
  };
}

async function saveModels(
  headers: Record<string, string>,
  models: ChatModel[],
  automatic: AutomaticModel,
  scope: "personal" | "repository",
): Promise<void> {
  const res = await fetch(
    scope === "repository" ? "/api/kody/repository-models" : "/api/kody/models",
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ models, automatic }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export async function saveEngineModels(
  headers: Record<string, string>,
  models: ChatModel[],
  automatic: AutomaticModel,
): Promise<void> {
  const res = await fetch("/api/kody/engine-models", {
    method: "PUT",
    headers,
    body: JSON.stringify({ models, automatic }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    engineSyncWarning?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  if (json.engineSyncWarning) {
    throw new Error(json.engineSyncWarning);
  }
}

function blankModel(): ChatModel {
  const p = PROVIDER_PRESETS.anthropic;
  return {
    id: "",
    label: "",
    provider: "anthropic",
    adapter: p.adapter,
    adapterBaseURL: p.adapterBaseURL,
    protocol: p.protocol,
    baseURL: p.baseURL,
    modelName: "",
    apiKeySecret: p.keyHint,
    enabled: true,
    automatic: false,
    default: false,
    engineDefault: false,
  };
}

/** Derive an internal id when the user didn't override it. */
function deriveId(m: ChatModel): string {
  if (m.id.trim()) return m.id.trim();
  if (!m.modelName.trim()) return "";
  return `${m.provider}/${m.modelName.trim()}`;
}

function serviceSessionId(modelId: string): string {
  let hash = 2166136261;
  for (const char of modelId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `model-service-${(hash >>> 0).toString(36)}`;
}

async function executeLocalServiceCommand(
  model: ChatModel,
  action: "start" | "stop",
): Promise<void> {
  const response = await fetch("/api/kody/model-services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: model.id, action }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      body.message ??
        body.error ??
        `Service command failed (${response.status})`,
    );
  }
}

type ModelServiceStatus = "ready" | "loading" | "stopped" | "unknown";

async function fetchLocalServiceStatus(
  modelId: string,
): Promise<ModelServiceStatus> {
  const response = await fetch("/api/kody/model-services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId, action: "status" }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    status?: ModelServiceStatus;
  };
  return response.ok && body.status ? body.status : "unknown";
}

async function waitForLocalServiceStatus(
  modelId: string,
  expected: "ready" | "stopped",
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchLocalServiceStatus(modelId)) === expected) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error(
    expected === "ready"
      ? "The service command ran, but the model is still loading"
      : "The service did not stop",
  );
}

async function executeBrainServiceCommand(
  headers: Record<string, string>,
  model: ChatModel,
  action: "start" | "stop",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      client.disconnect();
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(
      () => finish(new Error("Brain terminal did not become ready")),
      30_000,
    );
    const client = new TerminalSessionClient({
      chatSessionId: serviceSessionId(model.id),
      transport: { type: "brain" },
      activityLimit: null,
      getSize: () => ({ cols: 120, rows: 36 }),
      requestSession: async (body) => {
        const response = await fetch("/api/kody/terminal/session", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const value = (await response.json().catch(() => ({}))) as {
          webSocketUrl?: string;
          session?: unknown;
          message?: string;
          error?: string;
        };
        if (!response.ok || !value.webSocketUrl || !value.session) {
          throw new Error(
            value.message ?? value.error ?? `HTTP ${response.status}`,
          );
        }
        return {
          webSocketUrl: value.webSocketUrl,
          session: TerminalSessionInputSchema.parse(value.session),
        };
      },
      createSocket: (url) =>
        new WebSocket(url) as unknown as TerminalClientSocket,
      onState: (state) => {
        if (state.connection === "error") {
          finish(new Error(state.error ?? "Brain terminal failed"));
          return;
        }
        if (state.connection !== "connected") return;
        if (action === "stop") client.sendInput("stop-interrupt", "\u0003");
        window.setTimeout(
          () => {
            const command =
              action === "start"
                ? model.service!.startCommand
                : model.service!.stopCommand;
            if (!client.sendInput(`${action}-${Date.now()}`, `${command}\r`)) {
              finish(new Error("Brain terminal rejected the command"));
              return;
            }
            window.setTimeout(() => finish(), 300);
          },
          action === "stop" ? 250 : 0,
        );
      },
    });
    void client.connect();
  });
}

async function executeServiceCommand(
  headers: Record<string, string>,
  model: ChatModel,
  action: "start" | "stop",
): Promise<void> {
  if (!model.service) throw new Error("This model has no service configured");
  if (model.service.machine === "local") {
    await executeLocalServiceCommand(model, action);
  } else {
    await executeBrainServiceCommand(headers, model, action);
  }
}

export function ModelsManager({
  scope = "personal",
}: {
  scope?: "personal" | "repository";
}) {
  const { auth } = useAuth();
  const headers = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const listQueryKey = modelsQueryKeys.list(scope);

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<{
    models: ChatModel[];
    automatic: AutomaticModel;
  }>({
    queryKey: listQueryKey,
    queryFn: () => fetchModels(headers, scope),
    enabled: scope === "personal" || !!auth,
    staleTime: 30_000,
  });
  const { data: engineData } = useQuery({
    queryKey: ["kody-engine-models", auth?.owner ?? null, auth?.repo ?? null],
    queryFn: () => fetchEngineModels(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const engineById = new Map(
    (engineData?.models ?? []).map((model) => [model.id, model]),
  );
  const scopedModels =
    scope === "personal"
      ? composeChatModelCatalog<ChatModel>(
          data?.models ?? [],
          KODY_BUILT_IN_CHAT_MODELS,
        )
      : (data?.models ?? []);
  const models: ChatModel[] = scopedModels.map((model) => ({
    ...model,
    engineDefault:
      scope === "personal" && engineById.get(model.id)?.engineDefault === true,
  }));
  const automatic = {
    ...(data?.automatic ?? { default: false, engineDefault: false }),
    engineDefault:
      scope === "personal" && engineData?.automatic?.engineDefault === true,
  };
  const selectedAutomaticModels = models.filter(
    (model) => model.automatic === true,
  );
  const automaticModels = models.filter(
    (model) => model.enabled !== false && model.automatic === true,
  );

  const save = useMutation({
    mutationFn: ({
      list,
      automatic: nextAutomatic,
    }: {
      list: ChatModel[];
      automatic: AutomaticModel;
    }) => {
      const forEngine = (entries: ChatModel[]) =>
        entries
          .filter((model) => model.provider !== "opencode-free")
          .map((model) => {
            const existing = engineById.get(model.id);
            return {
              ...model,
              default: existing?.default === true,
              engineDefault: model.engineDefault === true,
            };
          });
      const engineList = forEngine(list);
      const engineAutomatic = {
        ...(engineData?.automatic ?? { default: false, engineDefault: false }),
        engineDefault: nextAutomatic.engineDefault === true,
      };
      const requests: Promise<void>[] = [
        saveModels(
          headers,
          list,
          { ...nextAutomatic, engineDefault: false },
          scope,
        ),
      ];
      if (auth && scope === "personal") {
        if (
          JSON.stringify(engineList) !== JSON.stringify(forEngine(models)) ||
          engineAutomatic.engineDefault !== automatic.engineDefault
        ) {
          requests.push(saveEngineModels(headers, engineList, engineAutomatic));
        }
      }
      return Promise.all(requests).then(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      queryClient.invalidateQueries({ queryKey: ["kody-engine-models"] });
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save models"),
  });

  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; idx: number } | null
  >(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const localServiceModels = models.filter(
    (model) => model.service?.machine === "local",
  );
  const { data: serviceStatuses = {} } = useQuery<
    Record<string, ModelServiceStatus>
  >({
    queryKey: [
      "model-service-statuses",
      ...localServiceModels.map((m) => m.id),
    ],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          localServiceModels.map(async (model) => [
            model.id,
            await fetchLocalServiceStatus(model.id),
          ]),
        ),
      ),
    enabled: localServiceModels.length > 0,
    refetchInterval: 3_000,
  });

  const runServiceAction = async (
    model: ChatModel,
    action: "start" | "stop",
  ) => {
    const busyKey = `${model.id}:${action}`;
    setServiceBusy(busyKey);
    try {
      await executeServiceCommand(headers, model, action);
      if (model.service?.machine === "local") {
        await waitForLocalServiceStatus(
          model.id,
          action === "start" ? "ready" : "stopped",
          action === "start" ? 120_000 : 15_000,
        );
        await queryClient.invalidateQueries({
          queryKey: ["model-service-statuses"],
        });
      }
      toast.success(`Service ${action === "start" ? "started" : "stopped"}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Service command failed",
      );
    } finally {
      setServiceBusy(null);
    }
  };

  const upsert = async (next: ChatModel) => {
    let list = [...models];
    if (editing?.mode === "edit") {
      list[editing.idx] = next;
    } else {
      list.push(next);
    }
    // Enforce "at most one default" client-side by clearing the flag on
    // every other entry when this one sets it.
    const savedIdx = editing?.mode === "edit" ? editing.idx : list.length - 1;
    if (next.default) {
      list = list.map((m, i) =>
        i === savedIdx ? m : { ...m, default: false },
      );
    }
    if (next.engineDefault) {
      list = list.map((m, i) =>
        i === savedIdx ? m : { ...m, engineDefault: false },
      );
    }
    const nextAutomatic = {
      ...automatic,
      ...(next.default ? { default: false } : {}),
      ...(next.engineDefault ? { engineDefault: false } : {}),
    };
    await save.mutateAsync({ list, automatic: nextAutomatic });
    toast.success("Model saved");
    setEditing(null);
  };

  const toggleEnabled = (idx: number) => {
    const list = models.map((m, i) =>
      i === idx ? { ...m, enabled: m.enabled === false } : m,
    );
    const automaticCount = list.filter(
      (model) => model.enabled !== false && model.automatic === true,
    ).length;
    save.mutate({
      list,
      automatic:
        automaticCount < 2
          ? { ...automatic, default: false, engineDefault: false }
          : automatic,
    });
  };

  const toggleAutomatic = (idx: number) => {
    const list = models.map((model, modelIdx) =>
      modelIdx === idx
        ? { ...model, automatic: model.automatic !== true }
        : model,
    );
    const automaticCount = list.filter(
      (model) => model.enabled !== false && model.automatic === true,
    ).length;
    save.mutate({
      list,
      automatic:
        automaticCount < 2
          ? { ...automatic, default: false, engineDefault: false }
          : automatic,
    });
  };

  const moveAutomatic = (idx: number, offset: -1 | 1) => {
    const selectedIndices = models.flatMap((model, modelIdx) =>
      model.automatic === true ? [modelIdx] : [],
    );
    const selectedPosition = selectedIndices.indexOf(idx);
    const target = selectedIndices[selectedPosition + offset];
    if (target === undefined) return;
    const list = [...models];
    [list[idx], list[target]] = [list[target]!, list[idx]!];
    save.mutate({ list, automatic });
  };

  const setAutomaticChatDefault = (checked: boolean) => {
    const list = checked
      ? models.map((model) => ({ ...model, default: false }))
      : models;
    save.mutate({
      list,
      automatic: { ...automatic, default: checked },
    });
  };

  const setAutomaticEngineDefault = (checked: boolean) => {
    const list = checked
      ? models.map((model) => ({ ...model, engineDefault: false }))
      : models;
    save.mutate({
      list,
      automatic: { ...automatic, engineDefault: checked },
    });
  };

  const remove = (idx: number) => {
    const list = models.filter((_, i) => i !== idx);
    save.mutateAsync({ list, automatic }).then(() => {
      toast.success("Model deleted");
      setDeleting(null);
    });
  };

  return (
    <PageShell
      title={
        scope === "repository"
          ? "Repository Chat Models"
          : "Personal Chat Models"
      }
      icon={Bot}
      iconClassName="text-violet-400"
      actions={
        <Button
          size="sm"
          onClick={() => setEditing({ mode: "create" })}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New model
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-white/55">
          {scope === "repository"
            ? `These chat models are shared with everyone using ${auth?.owner}/${auth?.repo}. API keys stay in repository Secrets.`
            : "Your chat models belong to your Kody account. API keys stay in repository Secrets."}
        </p>
        {auth ? (
          <p className="text-sm text-white/55">
            Repository automation uses Engine Models configured in{" "}
            <RepoScopedLink className="underline" href="/variables">
              Variables
            </RepoScopedLink>
            .
          </p>
        ) : null}

        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading models…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load models
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && (
          <Card className="border-sky-500/20 bg-sky-500/[0.05]">
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-white/90">
                    Automatic
                  </span>
                  {automatic.default && (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
                      title="Used for new conversations"
                    >
                      <Star className="h-3 w-3" /> Chat
                    </span>
                  )}
                  {scope === "personal" && automatic.engineDefault && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                      <Cpu className="w-3 h-3" /> Engine
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/45 mt-0.5">
                  {automaticModels.length >= 2
                    ? `Uses ${automaticModels.length} selected models in order when one is rate limited.`
                    : "Select at least two models below."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <Checkbox
                    checked={automatic.default === true}
                    disabled={automaticModels.length < 2}
                    onCheckedChange={(checked) =>
                      setAutomaticChatDefault(checked === true)
                    }
                    aria-label="Use Automatic as the Chat default"
                  />
                  Chat default
                </label>
                {scope === "personal" ? (
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <Checkbox
                      checked={automatic.engineDefault === true}
                      disabled={
                        automaticModels.filter(
                          (model) => model.provider !== "opencode-free",
                        ).length < 2
                      }
                      onCheckedChange={(checked) =>
                        setAutomaticEngineDefault(checked === true)
                      }
                      aria-label="Use Automatic as the Engine default"
                    />
                    Engine default
                  </label>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {models.map((m, idx) => (
            <li key={idx}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div
                      className={`min-w-0 ${m.enabled === false ? "opacity-55" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white/90 truncate">
                          {m.label || m.modelName || m.id}
                        </span>
                        {KODY_BUILT_IN_CHAT_MODELS.some(
                          (builtIn) => builtIn.id === m.id,
                        ) ? (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">
                            Built in
                          </span>
                        ) : null}
                        {m.enabled === false && (
                          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                            Disabled
                          </span>
                        )}
                        {m.service?.machine === "local" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                              serviceStatuses[m.id] === "ready"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : serviceStatuses[m.id] === "loading"
                                  ? "bg-amber-500/15 text-amber-300"
                                  : serviceStatuses[m.id] === "stopped"
                                    ? "bg-rose-500/15 text-rose-300"
                                    : "bg-white/[0.06] text-white/50"
                            }`}
                            aria-label={`Service status: ${serviceStatuses[m.id] ?? "unknown"}`}
                          >
                            {serviceStatuses[m.id] === "ready"
                              ? "Ready"
                              : serviceStatuses[m.id] === "loading"
                                ? "Loading"
                                : serviceStatuses[m.id] === "stopped"
                                  ? "Stopped"
                                  : "Checking"}
                          </span>
                        )}
                        {m.default && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300"
                            title="Used for new conversations"
                          >
                            <Star className="w-3 h-3" />
                            Chat
                          </span>
                        )}
                        {scope === "personal" && m.engineDefault && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300"
                            title="The model the engine runs (Kody Live, issue + PR runs)"
                          >
                            <Cpu className="w-3 h-3" />
                            Engine
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/45 mt-0.5 font-mono truncate">
                        {PROVIDER_PRESETS[m.provider]?.label ?? m.provider} ·{" "}
                        {m.modelName}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1">
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/60 hover:bg-white/[0.04] hover:text-white/80">
                      <Checkbox
                        checked={m.automatic === true}
                        disabled={m.enabled === false || save.isPending}
                        onCheckedChange={() => toggleAutomatic(idx)}
                        aria-label={`Include ${m.label || m.modelName} in Automatic`}
                      />
                      Auto
                    </label>
                    {m.automatic === true && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={
                            selectedAutomaticModels[0]?.id === m.id ||
                            save.isPending
                          }
                          onClick={() => moveAutomatic(idx, -1)}
                          aria-label={`Move ${m.label || m.modelName} up in Automatic`}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={
                            selectedAutomaticModels.at(-1)?.id === m.id ||
                            save.isPending
                          }
                          onClick={() => moveAutomatic(idx, 1)}
                          aria-label={`Move ${m.label || m.modelName} down in Automatic`}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`More actions for ${m.label || m.modelName}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        {m.service?.machine === "local" && (
                          <>
                            <DropdownMenuItem
                              disabled={
                                serviceBusy !== null ||
                                !serviceStatuses[m.id] ||
                                serviceStatuses[m.id] === "unknown"
                              }
                              onClick={() =>
                                void runServiceAction(
                                  m,
                                  serviceStatuses[m.id] === "ready" ||
                                    serviceStatuses[m.id] === "loading"
                                    ? "stop"
                                    : "start",
                                )
                              }
                            >
                              {serviceBusy?.startsWith(`${m.id}:`) ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : serviceStatuses[m.id] === "ready" ||
                                serviceStatuses[m.id] === "loading" ? (
                                <Square className="h-3.5 w-3.5" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              {serviceBusy === `${m.id}:start`
                                ? "Starting…"
                                : serviceBusy === `${m.id}:stop`
                                  ? "Stopping…"
                                  : serviceStatuses[m.id] === "ready" ||
                                      serviceStatuses[m.id] === "loading"
                                    ? "Stop service"
                                    : serviceStatuses[m.id] === "stopped"
                                      ? "Start service"
                                      : "Checking service…"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        {m.service?.machine === "brain" && (
                          <>
                            <DropdownMenuItem
                              disabled={
                                serviceBusy !== null ||
                                (m.service.machine === "brain" && !auth)
                              }
                              onClick={() => void runServiceAction(m, "start")}
                            >
                              {serviceBusy === `${m.id}:start` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              {serviceBusy === `${m.id}:start`
                                ? "Starting…"
                                : "Start service"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={
                                serviceBusy !== null ||
                                (m.service.machine === "brain" && !auth)
                              }
                              onClick={() => void runServiceAction(m, "stop")}
                            >
                              {serviceBusy === `${m.id}:stop` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Square className="h-3.5 w-3.5" />
                              )}
                              Stop service
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem onClick={() => toggleEnabled(idx)}>
                          <Power className="h-3.5 w-3.5" />
                          {m.enabled === false
                            ? "Enable model"
                            : "Disable model"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setEditing({ mode: "edit", idx })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                        {!KODY_BUILT_IN_CHAT_MODELS.some(
                          (builtIn) => builtIn.id === m.id,
                        ) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-rose-300 focus:text-rose-200"
                              onClick={() => setDeleting(idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      {editing && (
        <ModelEditor
          initial={editing.mode === "edit" ? models[editing.idx] : blankModel()}
          existing={models}
          editingIdx={editing.mode === "edit" ? editing.idx : null}
          saving={save.isPending}
          allowEngineDefault={scope === "personal"}
          onClose={() => setEditing(null)}
          onSave={upsert}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this model?"
        description={
          scope === "repository"
            ? "The model is removed for everyone using this repository. Its secret is not changed."
            : "The model is removed from your account. Its repository secret is not changed."
        }
        confirmLabel={save.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting !== null) remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface ModelEditorProps {
  initial: ChatModel;
  existing: ChatModel[];
  editingIdx: number | null;
  saving: boolean;
  allowEngineDefault: boolean;
  onClose: () => void;
  onSave: (m: ChatModel) => Promise<void>;
}

function ModelEditor({
  initial,
  existing,
  editingIdx,
  saving,
  allowEngineDefault,
  onClose,
  onSave,
}: ModelEditorProps) {
  const [draft, setDraft] = useState<ChatModel>(initial);
  const isFree = draft.provider === "opencode-free";
  const freeCatalog = useQuery({
    queryKey: ["model-provider-catalog", "opencode-free"],
    enabled: isFree,
    staleTime: 0,
    refetchInterval: 300_000,
    retry: false,
    queryFn: async (): Promise<
      Array<{
        id: string;
        label: string;
        adapter: "openai-compatible" | "openai-responses";
      }>
    > => {
      const response = await fetch("/api/kody/models?catalog=opencode-free", {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "OpenCode's free model list is unavailable. Try again later.",
        );
      return (await response.json()).models;
    },
  });
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(
    initial.provider === "custom",
  );
  // When the user picks a different preset, refresh the auto-managed
  // fields. The user's modelName + label survive — only adapter/protocol,
  // endpoints, and key hint update.
  const applyPreset = (preset: ProviderPreset) => {
    const p = PROVIDER_PRESETS[preset];
    setDraft((cur) => ({
      ...cur,
      provider: preset,
      adapter: p.adapter,
      adapterBaseURL: p.adapterBaseURL,
      protocol: p.protocol,
      baseURL: p.baseURL,
      ...(preset === "opencode-free"
        ? {
            modelName: "",
            label: "",
            apiKeySecret: "",
            engineDefault: false,
            service: undefined,
          }
        : {}),
      // Only overwrite the key hint when the user hasn't typed a custom
      // value yet (i.e. it matches the previous preset's hint). Avoids
      // clobbering a deliberate override.
      apiKeySecret:
        preset === "opencode-free" ||
        cur.apiKeySecret === PROVIDER_PRESETS[cur.provider].keyHint
          ? p.keyHint
          : cur.apiKeySecret,
    }));
    if (preset === "custom") setAdvancedOpen(true);
  };

  // Derived id — what we'll actually save when the user hasn't set one.
  const derivedId = deriveId(draft);
  const idClash =
    derivedId !== "" &&
    existing.some((m, i) => i !== editingIdx && deriveId(m) === derivedId);

  const errors = {
    label: draft.label.trim() ? null : "Required",
    modelName: draft.modelName.trim() ? null : "Required",
    apiKeySecret: isFree
      ? null
      : !draft.apiKeySecret.trim()
        ? "Required"
        : !SECRET_NAME_RE.test(draft.apiKeySecret)
          ? "Uppercase letters, digits, _ — start with a letter"
          : null,
    baseURL:
      draft.protocol === "openai" && !draft.baseURL.trim()
        ? "Required for OpenAI-compatible models"
        : null,
    adapterBaseURL:
      draft.adapter === "openai-compatible" && !draft.adapterBaseURL?.trim()
        ? "Required for OpenAI-compatible chat"
        : null,
    id: idClash ? "Another model already uses this id" : null,
    serviceStart:
      draft.service && !draft.service.startCommand.trim() ? "Required" : null,
    serviceStop:
      draft.service && !draft.service.stopCommand.trim() ? "Required" : null,
  };
  const canSave =
    !saving &&
    (!isFree ||
      (!freeCatalog.isError &&
        !freeCatalog.isFetching &&
        freeCatalog.data?.some((entry) => entry.id === draft.modelName))) &&
    !errors.label &&
    !errors.modelName &&
    !errors.apiKeySecret &&
    !errors.baseURL &&
    !errors.adapterBaseURL &&
    !errors.id &&
    !errors.serviceStart &&
    !errors.serviceStop;

  const handleSave = () => {
    if (!canSave) return;
    const finalModel: ChatModel = {
      ...draft,
      id: derivedId,
    };
    onSave(finalModel);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        modalSize="wide"
        modalHeight="viewport"
        className="min-w-0"
      >
        <DialogHeader>
          <DialogTitle>
            {editingIdx !== null ? "Edit model" : "Add model"}
          </DialogTitle>
          <DialogDescription>
            Pick a provider and model. Add an API key name when required.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex min-h-0 min-w-0 flex-col gap-3 overflow-visible">
          <div>
            <Label className="text-xs">Provider</Label>
            <select
              aria-label="Provider"
              value={draft.provider}
              onChange={(ev) => applyPreset(ev.target.value as ProviderPreset)}
              className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-sm"
            >
              {PROVIDER_PRESET_IDS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_PRESETS[p].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Model name</Label>
            {isFree ? (
              <>
                <select
                  aria-label="Model name"
                  value={draft.modelName}
                  disabled={freeCatalog.isFetching || freeCatalog.isError}
                  className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-sm"
                  onChange={(event) => {
                    const entry = freeCatalog.data?.find(
                      (entry) => entry.id === event.target.value,
                    );
                    if (entry)
                      setDraft((current) => ({
                        ...current,
                        modelName: entry.id,
                        label: entry.label,
                        adapter: entry.adapter,
                      }));
                  }}
                >
                  <option value="">
                    {freeCatalog.isFetching
                      ? "Loading free models…"
                      : "Choose a free model"}
                  </option>
                  {!freeCatalog.isError &&
                    freeCatalog.data?.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </select>
                {freeCatalog.isError ? (
                  <p role="alert" className="mt-1 text-xs text-rose-300">
                    {freeCatalog.error.message}{" "}
                    <button
                      type="button"
                      onClick={() => void freeCatalog.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                ) : null}
                {!freeCatalog.isFetching &&
                !freeCatalog.isError &&
                freeCatalog.data?.length === 0 ? (
                  <p className="mt-1 text-xs">
                    No compatible free models are currently listed.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-white/60">
                  No API key needed. List refreshes every five minutes. Free
                  access may be limited or withdrawn. These providers may use
                  prompts and replies for training; avoid private data.{" "}
                  <a
                    href="https://opencode.ai/docs/zen/#privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    OpenCode privacy details
                  </a>
                </p>
              </>
            ) : (
              <Input
                value={draft.modelName}
                onChange={(ev) =>
                  setDraft((cur) => ({
                    ...cur,
                    modelName: ev.target.value.trim(),
                  }))
                }
                placeholder={
                  draft.provider === "anthropic"
                    ? "claude-sonnet-4-6"
                    : draft.provider === "google"
                      ? "gemini-2.5-flash"
                      : draft.provider === "openai"
                        ? "gpt-4o"
                        : "model-id"
                }
                className="font-mono text-xs"
              />
            )}
            {errors.modelName && (
              <p className="text-[11px] text-rose-300 mt-1">
                {errors.modelName}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Display label</Label>
            <Input
              value={draft.label}
              onChange={(ev) =>
                setDraft((cur) => ({ ...cur, label: ev.target.value }))
              }
              placeholder="Claude Sonnet 4.6"
              className="text-xs"
              autoFocus={editingIdx === null}
            />
            {errors.label && (
              <p className="text-[11px] text-rose-300 mt-1">{errors.label}</p>
            )}
          </div>

          {!isFree && (
            <div>
              <Label htmlFor="model-api-key-name" className="text-sm">
                API key name
              </Label>
              <Input
                id="model-api-key-name"
                value={draft.apiKeySecret}
                onChange={(ev) =>
                  setDraft((cur) => ({
                    ...cur,
                    apiKeySecret: ev.target.value.toUpperCase(),
                  }))
                }
                placeholder="ANTHROPIC_API_KEY"
                className="font-mono text-xs"
              />
              <p className="text-sm text-white/45 mt-1">
                Store its value in{" "}
                <RepoScopedLink
                  href="/secrets"
                  className="text-white/60 hover:text-white/80 underline"
                >
                  Secrets
                </RepoScopedLink>
                .
              </p>
              {errors.apiKeySecret && (
                <p className="text-[11px] text-rose-300 mt-1">
                  {errors.apiKeySecret}
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer pt-1">
            <Checkbox
              checked={draft.default === true}
              onCheckedChange={(checked) =>
                setDraft((cur) => ({ ...cur, default: checked === true }))
              }
            />
            <Star className="w-3.5 h-3.5 text-white/40" />
            Default for chat (used for new conversations)
          </label>

          {allowEngineDefault && !isFree ? (
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <Checkbox
                checked={draft.engineDefault === true}
                onCheckedChange={(checked) =>
                  setDraft((cur) => ({
                    ...cur,
                    engineDefault: checked === true,
                  }))
                }
              />
              <Cpu className="w-3.5 h-3.5 text-white/40" />
              Default for engine (Kody Live, issue + PR runs)
            </label>
          ) : null}

          {!isFree && (
            <section
              className="space-y-3 border-t border-white/[0.06] pt-3"
              aria-labelledby="model-service-heading"
            >
              <div>
                <h3
                  id="model-service-heading"
                  className="text-sm font-medium text-white/85"
                >
                  Service
                </h3>
                <p className="mt-0.5 text-[11px] text-white/45">
                  Optional commands for managing this model server.
                </p>
              </div>
              <div>
                <Label className="text-xs">Machine</Label>
                <select
                  value={draft.service?.machine ?? "none"}
                  onChange={(event) => {
                    const machine = event.target.value;
                    setDraft((current) => {
                      if (machine === "none") {
                        const { service: _, ...rest } = current;
                        return rest as ChatModel;
                      }
                      return {
                        ...current,
                        service: {
                          machine: machine as "local" | "brain",
                          startCommand: current.service?.startCommand ?? "",
                          stopCommand: current.service?.stopCommand ?? "",
                        },
                      };
                    });
                  }}
                  className="h-9 w-full rounded-md border border-white/[0.08] bg-background px-2 text-sm"
                >
                  <option value="none">None</option>
                  <option value="local">Local</option>
                  <option value="brain">Brain</option>
                </select>
              </div>
              {draft.service && (
                <>
                  <div>
                    <Label className="text-xs">Start command</Label>
                    <Input
                      value={draft.service.startCommand}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          service: {
                            ...current.service!,
                            startCommand: event.target.value,
                          },
                        }))
                      }
                      placeholder="llama-server --port 8080"
                      className="font-mono text-xs"
                    />
                    {errors.serviceStart && (
                      <p className="mt-1 text-[11px] text-rose-300">
                        {errors.serviceStart}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Stop command</Label>
                    <Input
                      value={draft.service.stopCommand}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          service: {
                            ...current.service!,
                            stopCommand: event.target.value,
                          },
                        }))
                      }
                      placeholder="pkill -INT -f llama-server"
                      className="font-mono text-xs"
                    />
                    {errors.serviceStop && (
                      <p className="mt-1 text-[11px] text-rose-300">
                        {errors.serviceStop}
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {!isFree && (
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-xs text-white/55 hover:text-white/80 flex items-center gap-1 pt-2"
            >
              {advancedOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Advanced
            </button>
          )}

          {advancedOpen && !isFree && (
            <div className="space-y-3 pt-1 border-t border-white/[0.06]">
              <div>
                <Label className="text-xs">Chat adapter</Label>
                <select
                  value={
                    draft.adapter ?? PROVIDER_PRESETS[draft.provider].adapter
                  }
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      adapter: ev.target.value as ChatAdapter,
                    }))
                  }
                  className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-xs font-mono"
                >
                  <option value="anthropic">anthropic</option>
                  <option value="google">google</option>
                  <option value="openai-compatible">openai-compatible</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Chat API URL</Label>
                <Input
                  value={draft.adapterBaseURL ?? ""}
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      adapterBaseURL: ev.target.value.trim(),
                    }))
                  }
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-xs"
                />
                {errors.adapterBaseURL && (
                  <p className="text-[11px] text-rose-300 mt-1">
                    {errors.adapterBaseURL}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Engine API URL</Label>
                <Input
                  value={draft.baseURL}
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      baseURL: ev.target.value.trim(),
                    }))
                  }
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-xs"
                />
                {errors.baseURL && (
                  <p className="text-[11px] text-rose-300 mt-1">
                    {errors.baseURL}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Engine protocol</Label>
                <select
                  value={draft.protocol}
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      protocol: ev.target.value as ChatProtocol,
                    }))
                  }
                  className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-xs font-mono"
                >
                  <option value="anthropic">anthropic</option>
                  <option value="openai">openai-compatible</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Internal id (auto)</Label>
                <Input
                  value={draft.id || derivedId}
                  onChange={(ev) =>
                    setDraft((cur) => ({ ...cur, id: ev.target.value.trim() }))
                  }
                  placeholder={derivedId || "<provider>/<modelName>"}
                  className="font-mono text-xs"
                />
                {errors.id && (
                  <p className="text-[11px] text-rose-300 mt-1">{errors.id}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Max research steps</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={draft.maxSteps ?? ""}
                  onChange={(ev) => {
                    const raw = ev.target.value.trim();
                    if (raw === "") {
                      setDraft((cur) => {
                        const { maxSteps: _, ...rest } = cur;
                        return rest as ChatModel;
                      });
                      return;
                    }
                    const n = Number.parseInt(raw, 10);
                    if (!Number.isFinite(n)) return;
                    setDraft((cur) => ({ ...cur, maxSteps: n }));
                  }}
                  placeholder="10 (default)"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Per-turn tool-call rounds. Blank → 10. Raise for models that
                  need long research chains.
                </p>
              </div>
            </div>
          )}
          <div className="mt-auto flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!canSave}
              onClick={handleSave}
              className="gap-1"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {editingIdx !== null ? "Save" : "Add"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
