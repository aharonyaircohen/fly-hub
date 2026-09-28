/**
 * @fileType component
 * @domain triggers
 * @pattern triggers-manager
 * @ai-summary CRUD UI for trigger rules ("when something happens, do Y").
 *   Rules live at `triggers/config.json` in the backend; the editor presents
 *   them as a readable When → Then sentence while preserving the existing
 *   event and action contracts. Follows the standard admin-page structure:
 *   PageShell + card rows with status icon and Power toggle + ui-kit
 *   dialog editor.
 */
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleDot,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { SYSTEM_EVENT_NAMES } from "@kody-ade/base/events/catalog";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Checkbox } from "@kody-ade/base/ui/checkbox";
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
import { slugifyTitle } from "@kody-ade/base/slug";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { PageShell } from "./PageShell";

const GITHUB_WORKFLOW_COMPLETED_EVENT = "github.workflow_run.completed";
const ALL_GITHUB_WORKFLOWS = "all-github-workflows";
const KODY_WORKFLOW_COMPLETED_EVENT = "kody.workflow.completed";
const WORKFLOW_COMPLETED_EVENTS = new Set([
  GITHUB_WORKFLOW_COMPLETED_EVENT,
  KODY_WORKFLOW_COMPLETED_EVENT,
]);
const EVENT_LABELS: Record<string, string> = {
  "session.started": "A chat session starts",
  "session.ended": "A chat session ends",
  "chat.message.sent": "A chat message is sent",
  "chat.response.completed": "A chat response completes",
  "ui.view.shown": "A view is shown",
  "ui.form.submitted": "A form is submitted",
  "ui.action.clicked": "A UI action is clicked",
  "auth.signed_in": "A user signs in",
  "auth.signed_out": "A user signs out",
  "page.viewed": "A page is viewed",
  "model.save.proposed": "Kody proposes saving state",
  "state.entity.written": "State is saved",
  "system.error": "A system error occurs",
  [GITHUB_WORKFLOW_COMPLETED_EVENT]: "GitHub workflow finishes",
  [KODY_WORKFLOW_COMPLETED_EVENT]: "Kody workflow finishes",
};
const WORKFLOW_CONCLUSIONS = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
] as const;
type WorkflowConclusion = (typeof WORKFLOW_CONCLUSIONS)[number];
const KODY_WORKFLOW_STATUSES = ["success", "failed"] as const;
type KodyWorkflowStatus = (typeof KODY_WORKFLOW_STATUSES)[number];

interface GitHubWorkflowOption {
  id: number;
  name: string;
  path: string;
  state: string;
}

interface KodyWorkflowOption {
  id: string;
  workflow: {
    name: string;
    inputSchema?: { properties?: Record<string, unknown> };
  };
  runnable?: boolean;
  automation:
    { eligible: true } | { eligible: false; reason: "approval-required" };
}

interface KodyPipelineOption {
  id: string;
  pipeline: {
    name: string;
    inputSchema?: { properties?: Record<string, unknown> };
  };
  runnable?: boolean;
  automation:
    { eligible: true } | { eligible: false; reason: "approval-required" };
}

interface TriggerRow {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  conditions: Array<{ path: string; op: string; value?: unknown }>;
  action:
    | {
        type: "save-user-state";
        namespace: string;
        map: Record<string, string>;
      }
    | {
        type: "start-workflow";
        workflowId: string;
        inputMap: Record<string, string>;
      }
    | {
        type: "start-pipeline";
        pipelineId: string;
        inputMap: Record<string, string>;
      };
}

interface NamespaceRow {
  name: string;
  origin: "core" | "brand";
  modelWritable: boolean;
}

const triggersQueryKey = (owner: string | null, repo: string | null) =>
  ["kody-triggers", owner, repo] as const;
const namespacesQueryKey = (owner: string | null, repo: string | null) =>
  ["kody-user-state-namespaces", owner, repo] as const;

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(
      json.detail || json.message || json.error || `HTTP ${res.status}`,
    );
  }
  return json;
}

interface EditorState {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  actionType: "" | "save-user-state" | "start-workflow" | "start-pipeline";
  namespace: string;
  workflowId: string;
  pipelineId: string;
  githubWorkflowId: number | null;
  githubWorkflowName: string;
  githubWorkflowConclusion: WorkflowConclusion | "";
  kodySourceWorkflowId: string;
  kodyWorkflowStatus: KodyWorkflowStatus | "";
  conditions: Array<{ path: string; op: string; value: string }>;
  map: Array<{ key: string; source: string }>;
  isNew: boolean;
}

function actionTypeForEvent(event: string): EditorState["actionType"] {
  if (!event) return "";
  return WORKFLOW_COMPLETED_EVENTS.has(event)
    ? "start-workflow"
    : "save-user-state";
}

function conditionRows(
  conditions: TriggerRow["conditions"],
): EditorState["conditions"] {
  return conditions.map((condition) => ({
    path: condition.path,
    op: condition.op,
    value: condition.value == null ? "" : String(condition.value),
  }));
}

function mapRows(map: Record<string, string>): EditorState["map"] {
  return Object.entries(map).map(([key, source]) => ({ key, source }));
}

function isPullRequestOnlyCondition(
  condition: EditorState["conditions"][number],
): boolean {
  return condition.path === "pr" && condition.op === "exists";
}

function withPullRequestOnlyCondition(
  conditions: EditorState["conditions"],
  enabled: boolean,
): EditorState["conditions"] {
  const remaining = conditions.filter(
    (condition) => !isPullRequestOnlyCondition(condition),
  );
  return enabled
    ? [...remaining, { path: "pr", op: "exists", value: "" }]
    : remaining;
}

function defaultInputMap(
  target:
    KodyWorkflowOption["workflow"] | KodyPipelineOption["pipeline"] | undefined,
): EditorState["map"] {
  const properties = target?.inputSchema?.properties;
  if (!properties) return [];
  return Object.keys(properties).map((key) => ({
    key,
    source: `payload.${key}`,
  }));
}

function editorFromTrigger(trigger: TriggerRow): EditorState {
  const action = trigger.action;
  const isWorkflow = action.type === "start-workflow";
  const isPipeline = action.type === "start-pipeline";
  const githubWorkflowIdCondition = trigger.conditions.find(
    (condition) => condition.path === "workflowId" && condition.op === "equals",
  );
  const githubWorkflowNameCondition = trigger.conditions.find(
    (condition) =>
      condition.path === "workflowName" && condition.op === "equals",
  );
  const githubWorkflowId =
    typeof githubWorkflowIdCondition?.value === "number" &&
    Number.isSafeInteger(githubWorkflowIdCondition.value)
      ? githubWorkflowIdCondition.value
      : typeof githubWorkflowIdCondition?.value === "string" &&
          /^\d+$/.test(githubWorkflowIdCondition.value)
        ? Number(githubWorkflowIdCondition.value)
        : null;
  const githubWorkflowName =
    typeof githubWorkflowNameCondition?.value === "string"
      ? githubWorkflowNameCondition.value
      : "";
  const githubWorkflowConclusionCondition = trigger.conditions.find(
    (condition) => condition.path === "conclusion" && condition.op === "equals",
  );
  const githubWorkflowConclusion = WORKFLOW_CONCLUSIONS.includes(
    githubWorkflowConclusionCondition?.value as WorkflowConclusion,
  )
    ? (githubWorkflowConclusionCondition?.value as WorkflowConclusion)
    : "";
  const kodySourceWorkflowIdCondition = trigger.conditions.find(
    (condition) => condition.path === "workflowId" && condition.op === "equals",
  );
  const kodySourceWorkflowId =
    trigger.event === KODY_WORKFLOW_COMPLETED_EVENT &&
    typeof kodySourceWorkflowIdCondition?.value === "string"
      ? kodySourceWorkflowIdCondition.value
      : "";
  const kodyWorkflowStatusCondition = trigger.conditions.find(
    (condition) => condition.path === "status" && condition.op === "equals",
  );
  const kodyWorkflowStatus = KODY_WORKFLOW_STATUSES.includes(
    kodyWorkflowStatusCondition?.value as KodyWorkflowStatus,
  )
    ? (kodyWorkflowStatusCondition?.value as KodyWorkflowStatus)
    : "";
  return {
    id: trigger.id,
    name: trigger.name,
    enabled: trigger.enabled,
    event: trigger.event,
    actionType: trigger.action.type,
    namespace: action.type === "save-user-state" ? action.namespace : "",
    workflowId: isWorkflow ? action.workflowId : "",
    pipelineId: isPipeline ? action.pipelineId : "",
    githubWorkflowId,
    githubWorkflowName,
    githubWorkflowConclusion,
    kodySourceWorkflowId,
    kodyWorkflowStatus,
    conditions: conditionRows(
      trigger.conditions.filter(
        (condition) =>
          !["workflowId", "workflowName", "conclusion", "status"].includes(
            condition.path,
          ),
      ),
    ),
    map: mapRows(
      action.type === "save-user-state" ? action.map : action.inputMap,
    ),
    isNew: false,
  };
}

function emptyEditor(defaultNamespace: string): EditorState {
  return {
    id: "",
    name: "",
    enabled: true,
    event: "",
    actionType: "",
    namespace: defaultNamespace,
    workflowId: "",
    pipelineId: "",
    githubWorkflowId: null,
    githubWorkflowName: "",
    githubWorkflowConclusion: "",
    kodySourceWorkflowId: "",
    kodyWorkflowStatus: "",
    conditions: [],
    map: [],
    isNew: true,
  };
}

function EventOptions() {
  return (
    <>
      {SYSTEM_EVENT_NAMES.map((name) => (
        <SelectItem key={name} value={name}>
          {EVENT_LABELS[name] ?? name}
        </SelectItem>
      ))}
    </>
  );
}

export function TriggersManager() {
  const { auth } = useAuth();
  const headers = useMemo(
    () => ({ "content-type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const owner = auth?.owner ?? null;
  const repo = auth?.repo ?? null;
  const queryClient = useQueryClient();

  const triggersQuery = useQuery({
    queryKey: triggersQueryKey(owner, repo),
    enabled: !!auth,
    queryFn: () =>
      fetchJson<{ triggers: TriggerRow[] }>("/api/kody/triggers", headers).then(
        (json) => json.triggers ?? [],
      ),
  });
  const namespacesQuery = useQuery({
    queryKey: namespacesQueryKey(owner, repo),
    enabled: !!auth,
    queryFn: () =>
      fetchJson<{ namespaces: NamespaceRow[] }>(
        "/api/kody/user-state",
        headers,
      ).then((json) => json.namespaces ?? []),
  });

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TriggerRow | null>(null);

  const githubWorkflowsQuery = useQuery({
    queryKey: ["kody-github-workflows", owner, repo] as const,
    enabled:
      !!auth && !!editor && editor.event === GITHUB_WORKFLOW_COMPLETED_EVENT,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      fetchJson<{ workflows: GitHubWorkflowOption[] }>(
        "/api/kody/github/workflows",
        headers,
      ).then((json) => json.workflows ?? []),
  });
  const workflowDefinitionsQuery = useQuery({
    queryKey: ["kody-workflow-definitions", owner, repo] as const,
    enabled:
      !!auth &&
      !!editor &&
      (editor.actionType === "start-workflow" ||
        editor.event === KODY_WORKFLOW_COMPLETED_EVENT),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      fetchJson<{ workflows: KodyWorkflowOption[] }>(
        "/api/kody/company/workflows",
        headers,
      ).then((json) => json.workflows ?? []),
  });
  const pipelineDefinitionsQuery = useQuery({
    queryKey: ["kody-pipeline-definitions", owner, repo] as const,
    enabled: !!auth && !!editor && editor.actionType === "start-pipeline",
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      fetchJson<{ pipelines: KodyPipelineOption[] }>(
        "/api/kody/company/pipelines",
        headers,
      ).then((json) => json.pipelines ?? []),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: triggersQueryKey(owner, repo) });

  const saveMutation = useMutation({
    mutationFn: async (state: EditorState) => {
      if (!state.event || !state.actionType) {
        throw new Error("Choose a trigger and an action");
      }
      const actionSupported = WORKFLOW_COMPLETED_EVENTS.has(state.event)
        ? state.actionType === "start-workflow" ||
          state.actionType === "start-pipeline"
        : state.actionType === "save-user-state";
      if (!actionSupported) {
        throw new Error("Choose the action supported by this trigger");
      }
      const advancedConditions = state.conditions
        .filter((condition) => condition.path.trim())
        .map((condition) => ({
          path: condition.path.trim(),
          op: condition.op,
          ...(condition.value.trim() ? { value: condition.value } : {}),
        }));
      const workflowConditions =
        state.event === GITHUB_WORKFLOW_COMPLETED_EVENT
          ? [
              ...(state.githubWorkflowId !== null
                ? [
                    {
                      path: "workflowId",
                      op: "equals",
                      value: state.githubWorkflowId,
                    },
                  ]
                : state.githubWorkflowName
                  ? [
                      {
                        path: "workflowName",
                        op: "equals",
                        value: state.githubWorkflowName,
                      },
                    ]
                  : []),
              ...(state.githubWorkflowConclusion
                ? [
                    {
                      path: "conclusion",
                      op: "equals",
                      value: state.githubWorkflowConclusion,
                    },
                  ]
                : []),
            ]
          : state.event === KODY_WORKFLOW_COMPLETED_EVENT
            ? [
                ...(state.kodySourceWorkflowId
                  ? [
                      {
                        path: "workflowId",
                        op: "equals",
                        value: state.kodySourceWorkflowId,
                      },
                    ]
                  : []),
                ...(state.kodyWorkflowStatus
                  ? [
                      {
                        path: "status",
                        op: "equals",
                        value: state.kodyWorkflowStatus,
                      },
                    ]
                  : []),
              ]
            : [];
      const conditions = [...workflowConditions, ...advancedConditions];
      const selectedWorkflow = workflowDefinitionsQuery.data?.find(
        (workflow) => workflow.id === state.workflowId,
      );
      const selectedPipeline = pipelineDefinitionsQuery.data?.find(
        (pipeline) => pipeline.id === state.pipelineId,
      );
      const mapRowsToSave =
        state.actionType !== "save-user-state" && state.map.length === 0
          ? defaultInputMap(
              state.actionType === "start-workflow"
                ? selectedWorkflow?.workflow
                : selectedPipeline?.pipeline,
            )
          : state.map;
      const map = Object.fromEntries(
        mapRowsToSave
          .filter((entry) => entry.key.trim() && entry.source.trim())
          .map((entry) => [entry.key.trim(), entry.source.trim()]),
      );
      await fetchJson("/api/kody/triggers", headers, {
        method: "POST",
        body: JSON.stringify({
          trigger: {
            id: state.isNew ? slugifyTitle(state.name) : state.id,
            name: state.name.trim(),
            enabled: state.enabled,
            event: state.event,
            conditions,
            action:
              state.actionType === "start-workflow"
                ? {
                    type: "start-workflow",
                    workflowId: state.workflowId.trim(),
                    inputMap: map,
                  }
                : state.actionType === "start-pipeline"
                  ? {
                      type: "start-pipeline",
                      pipelineId: state.pipelineId.trim(),
                      inputMap: map,
                    }
                  : {
                      type: "save-user-state",
                      namespace: state.namespace,
                      map,
                    },
          },
        }),
      });
    },
    onSuccess: () => {
      toast.success("Trigger saved");
      setEditor(null);
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (trigger: TriggerRow) =>
      fetchJson("/api/kody/triggers", headers, {
        method: "POST",
        body: JSON.stringify({
          trigger: { ...trigger, enabled: !trigger.enabled },
        }),
      }),
    onSuccess: () => void invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/kody/triggers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      }).then((res) => {
        if (!res.ok && res.status !== 204) {
          throw new Error(`HTTP ${res.status}`);
        }
      }),
    onSuccess: () => {
      toast.success("Trigger deleted");
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const namespaces = namespacesQuery.data ?? [];
  const triggers = triggersQuery.data ?? [];
  const githubWorkflows = githubWorkflowsQuery.data ?? [];
  const workflowDefinitions = workflowDefinitionsQuery.data ?? [];
  const kodyWorkflows = workflowDefinitions.filter(
    (workflow) =>
      workflow.runnable !== false && workflow.automation.eligible === true,
  );
  const selectedKodyWorkflowIsEligible = kodyWorkflows.some(
    (workflow) => workflow.id === editor?.workflowId,
  );
  const pipelineDefinitions = pipelineDefinitionsQuery.data ?? [];
  const kodyPipelines = pipelineDefinitions.filter(
    (pipeline) =>
      pipeline.runnable !== false && pipeline.automation.eligible === true,
  );
  const selectedKodyPipelineIsEligible = kodyPipelines.some(
    (pipeline) => pipeline.id === editor?.pipelineId,
  );
  const selectedGithubWorkflowValue = editor
    ? editor.githubWorkflowId !== null
      ? String(editor.githubWorkflowId)
      : editor.githubWorkflowName
        ? `name:${editor.githubWorkflowName}`
        : ALL_GITHUB_WORKFLOWS
    : ALL_GITHUB_WORKFLOWS;

  return (
    <PageShell
      title="Triggers"
      icon={Zap}
      subtitle="Connect something that happens to what Kody should do next."
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void invalidate()}
            disabled={triggersQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${triggersQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            size="sm"
            onClick={() => setEditor(emptyEditor(namespaces[0]?.name ?? ""))}
            disabled={!auth}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New trigger
          </Button>
        </>
      }
    >
      {triggersQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : triggers.length === 0 ? (
        <EmptyState
          icon={<Zap />}
          title="No triggers yet"
          hint="Create a rule like: when a GitHub workflow finishes, start a Kody workflow."
        />
      ) : (
        <div className="space-y-2">
          {triggers.map((trigger) => (
            <Card key={trigger.id}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  {trigger.enabled ? (
                    <CircleDot className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <PowerOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium">{trigger.name}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      When {EVENT_LABELS[trigger.event] ?? trigger.event}; then{" "}
                      {trigger.action.type === "start-workflow"
                        ? "start a Kody workflow"
                        : trigger.action.type === "start-pipeline"
                          ? "start a Kody pipeline"
                          : "save event data"}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={trigger.enabled ? "Disable" : "Enable"}
                    disabled={toggleMutation.isPending}
                    onClick={() => toggleMutation.mutate(trigger)}
                  >
                    <Power
                      className={`h-4 w-4 ${
                        trigger.enabled
                          ? "text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditor(editorFromTrigger(trigger))}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(trigger)}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor?.isNew ? "New trigger" : "Edit trigger"}
            </DialogTitle>
            <DialogDescription>
              Describe what should happen in one simple rule.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="trigger-name">Name</Label>
                <Input
                  id="trigger-name"
                  value={editor.name}
                  placeholder="Save quiz answers"
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-3 rounded-md border border-border/70 p-3">
                <div className="space-y-1">
                  <Label>When</Label>
                  <Select
                    value={editor.event}
                    onValueChange={(value) =>
                      setEditor({
                        ...editor,
                        event: value,
                        actionType: actionTypeForEvent(value),
                      })
                    }
                  >
                    <SelectTrigger aria-label="Trigger">
                      <SelectValue placeholder="Select a trigger" />
                    </SelectTrigger>
                    <SelectContent>
                      <EventOptions />
                    </SelectContent>
                  </Select>
                </div>
                {editor.event === GITHUB_WORKFLOW_COMPLETED_EVENT ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>GitHub workflow</Label>
                        <Select
                          value={selectedGithubWorkflowValue}
                          onValueChange={(value) => {
                            if (value === ALL_GITHUB_WORKFLOWS) {
                              setEditor({
                                ...editor,
                                githubWorkflowId: null,
                                githubWorkflowName: "",
                              });
                              return;
                            }
                            const workflow = githubWorkflows.find(
                              (candidate) => String(candidate.id) === value,
                            );
                            if (!workflow) return;
                            setEditor({
                              ...editor,
                              githubWorkflowId: workflow.id,
                              githubWorkflowName: workflow.name,
                            });
                          }}
                          disabled={githubWorkflowsQuery.isLoading}
                        >
                          <SelectTrigger aria-label="GitHub workflow">
                            <SelectValue
                              placeholder={
                                githubWorkflowsQuery.isLoading
                                  ? "Loading GitHub workflows…"
                                  : "Select a GitHub workflow"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all-github-workflows">
                              All GitHub workflows
                            </SelectItem>
                            {editor.githubWorkflowName &&
                            editor.githubWorkflowId === null &&
                            !githubWorkflows.some(
                              (workflow) =>
                                workflow.name === editor.githubWorkflowName,
                            ) ? (
                              <SelectItem
                                value={`name:${editor.githubWorkflowName}`}
                              >
                                {editor.githubWorkflowName}
                              </SelectItem>
                            ) : null}
                            {githubWorkflows.map((workflow) => (
                              <SelectItem
                                key={workflow.id}
                                value={String(workflow.id)}
                              >
                                {workflow.name}
                                {workflow.state === "active"
                                  ? ""
                                  : ` (${workflow.state.replaceAll("_", " ")})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Result</Label>
                        <Select
                          value={editor.githubWorkflowConclusion || "any"}
                          onValueChange={(value) =>
                            setEditor({
                              ...editor,
                              githubWorkflowConclusion:
                                value === "any"
                                  ? ""
                                  : (value as WorkflowConclusion),
                            })
                          }
                        >
                          <SelectTrigger aria-label="GitHub workflow result">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any result</SelectItem>
                            {WORKFLOW_CONCLUSIONS.map((conclusion) => (
                              <SelectItem key={conclusion} value={conclusion}>
                                {conclusion.replaceAll("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ) : null}
                {editor.event === KODY_WORKFLOW_COMPLETED_EVENT ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Kody workflow</Label>
                      <Select
                        value={editor.kodySourceWorkflowId}
                        onValueChange={(value) =>
                          setEditor({
                            ...editor,
                            kodySourceWorkflowId: value,
                          })
                        }
                        disabled={workflowDefinitionsQuery.isLoading}
                      >
                        <SelectTrigger aria-label="Kody workflow that finished">
                          <SelectValue placeholder="Select a Kody workflow" />
                        </SelectTrigger>
                        <SelectContent>
                          {workflowDefinitions.map((workflow) => (
                            <SelectItem key={workflow.id} value={workflow.id}>
                              {workflow.workflow.name} ({workflow.id})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Result</Label>
                      <Select
                        value={editor.kodyWorkflowStatus || "any"}
                        onValueChange={(value) =>
                          setEditor({
                            ...editor,
                            kodyWorkflowStatus:
                              value === "any"
                                ? ""
                                : (value as KodyWorkflowStatus),
                          })
                        }
                      >
                        <SelectTrigger aria-label="Kody workflow result">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any result</SelectItem>
                          {KODY_WORKFLOW_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
                {WORKFLOW_COMPLETED_EVENTS.has(editor.event) ? (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={editor.conditions.some(
                        isPullRequestOnlyCondition,
                      )}
                      onCheckedChange={(checked) =>
                        setEditor({
                          ...editor,
                          conditions: withPullRequestOnlyCondition(
                            editor.conditions,
                            checked === true,
                          ),
                        })
                      }
                    />
                    Pull request runs only
                  </label>
                ) : null}
              </div>
              <div className="space-y-3 rounded-md border border-border/70 p-3">
                <div className="space-y-1">
                  <Label>Then</Label>
                  <Select
                    value={editor.actionType}
                    onValueChange={(value: EditorState["actionType"]) =>
                      setEditor({
                        ...editor,
                        actionType: value,
                        ...(value === "save-user-state"
                          ? { workflowId: "", pipelineId: "" }
                          : value === "start-workflow"
                            ? { namespace: "", pipelineId: "" }
                            : { namespace: "", workflowId: "" }),
                      })
                    }
                    disabled={!editor.event}
                  >
                    <SelectTrigger aria-label="Action">
                      <SelectValue placeholder="Select an action" />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKFLOW_COMPLETED_EVENTS.has(editor.event) ? (
                        <>
                          <SelectItem value="start-workflow">
                            Start a Kody workflow
                          </SelectItem>
                          <SelectItem value="start-pipeline">
                            Start a Kody pipeline
                          </SelectItem>
                        </>
                      ) : editor.event ? (
                        <SelectItem value="save-user-state">
                          Save event data
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
                {editor.actionType === "start-workflow" ? (
                  <div className="space-y-1">
                    <Label>Kody workflow to start</Label>
                    <Select
                      value={editor.workflowId}
                      onValueChange={(value) =>
                        setEditor({ ...editor, workflowId: value })
                      }
                      disabled={
                        workflowDefinitionsQuery.isLoading ||
                        kodyWorkflows.length === 0
                      }
                    >
                      <SelectTrigger aria-label="Kody workflow to start">
                        <SelectValue
                          placeholder={
                            workflowDefinitionsQuery.isLoading
                              ? "Loading workflows…"
                              : "Select a workflow"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {kodyWorkflows.map((workflow) => (
                          <SelectItem key={workflow.id} value={workflow.id}>
                            {workflow.workflow.name} ({workflow.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!workflowDefinitionsQuery.isLoading &&
                    kodyWorkflows.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No workflows can run automatically. Allow one from{" "}
                        <a
                          className="underline underline-offset-2"
                          href={`/repo/${owner}/${repo}/workflows`}
                        >
                          Workflows
                        </a>
                        .
                      </p>
                    ) : null}
                  </div>
                ) : editor.actionType === "start-pipeline" ? (
                  <div className="space-y-1">
                    <Label>Kody pipeline to start</Label>
                    <Select
                      value={editor.pipelineId}
                      onValueChange={(value) =>
                        setEditor({ ...editor, pipelineId: value })
                      }
                      disabled={
                        pipelineDefinitionsQuery.isLoading ||
                        kodyPipelines.length === 0
                      }
                    >
                      <SelectTrigger aria-label="Kody pipeline to start">
                        <SelectValue
                          placeholder={
                            pipelineDefinitionsQuery.isLoading
                              ? "Loading pipelines…"
                              : "Select a pipeline"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {kodyPipelines.map((pipeline) => (
                          <SelectItem key={pipeline.id} value={pipeline.id}>
                            {pipeline.pipeline.name} ({pipeline.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!pipelineDefinitionsQuery.isLoading &&
                    kodyPipelines.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No pipelines can run automatically. Allow one from{" "}
                        <a
                          className="underline underline-offset-2"
                          href={`/repo/${owner}/${repo}/pipelines`}
                        >
                          Pipelines
                        </a>
                        .
                      </p>
                    ) : null}
                  </div>
                ) : editor.actionType === "save-user-state" ? (
                  <div className="space-y-1">
                    <Label>Save event data to</Label>
                    <Select
                      value={editor.namespace}
                      onValueChange={(value) =>
                        setEditor({ ...editor, namespace: value })
                      }
                    >
                      <SelectTrigger aria-label="Save event data to">
                        <SelectValue placeholder="Select an entity" />
                      </SelectTrigger>
                      <SelectContent>
                        {namespaces.map((ns) => (
                          <SelectItem key={ns.name} value={ns.name}>
                            {ns.name} ({ns.origin})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
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
                    !editor.event ||
                    !editor.actionType ||
                    (editor.actionType === "save-user-state"
                      ? !editor.namespace
                      : editor.actionType === "start-workflow"
                        ? !editor.workflowId.trim() ||
                          !selectedKodyWorkflowIsEligible ||
                          (editor.event === KODY_WORKFLOW_COMPLETED_EVENT &&
                            !editor.kodySourceWorkflowId)
                        : !editor.pipelineId.trim() ||
                          !selectedKodyPipelineIsEligible ||
                          (editor.event === KODY_WORKFLOW_COMPLETED_EVENT &&
                            !editor.kodySourceWorkflowId))
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
        title="Delete trigger?"
        description={`"${deleteTarget?.name}" will stop reacting to events.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </PageShell>
  );
}
