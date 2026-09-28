/**
 * @fileType component
 * @domain kody
 * @pattern workflows-manager
 * @ai-summary Visual workflow authoring and run tracking backed by the shared
 *   workflow validation boundary.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { useTrust } from "@dashboard/lib/cto/useTrust";
import {
  trustLevelForSubject,
  trustSubjectKey,
  type TrustLevel,
} from "@dashboard/lib/cto/trust-state";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
import { useCapabilities } from "@dashboard/lib/hooks/useCapabilities";
import { useAgents } from "@dashboard/lib/hooks/useAgents";
import {
  useCreateWorkflowDefinition,
  useDeleteWorkflowDefinition,
  useApproveWorkflowRun,
  useRunWorkflowDefinition,
  useUpdateWorkflowDefinition,
  useWorkflowDefinitions,
  useWorkflowRunState,
} from "@dashboard/lib/hooks/useWorkflowDefinitions";
import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";
import { workflowDefinitionGraph } from "@dashboard/lib/workflow-graph";
import { cn } from "@dashboard/lib/utils";
import { buildHeaders, handleResponse } from "@dashboard/lib/api";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { MasterDetailShell } from "@dashboard/lib/components/MasterDetailShell";
import { TrustLevelControl } from "@dashboard/lib/components/TrustLevelControl";
import { WorkflowEditorDialog } from "@dashboard/features/workflows/components/WorkflowEditorDialog";
import { WorkflowGraphCanvas } from "@dashboard/features/workflows/components/WorkflowGraphCanvas";
import { WorkflowRunDialog } from "@dashboard/features/workflows/components/WorkflowRunDialog";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { isBuiltInWorkflow } from "@dashboard/features/workflows/built-in-workflows";

const BASE_PATH = "/workflows";

interface WorkflowsManagerProps {
  selectedId?: string;
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workflowMatches(workflow: WorkflowDefinitionRecord, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const text = [
    workflow.id,
    workflow.workflow.name,
    ...workflow.workflow.capabilities,
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(q);
}

export function WorkflowsManager({ selectedId }: WorkflowsManagerProps) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] =
    useState<WorkflowDefinitionRecord | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] =
    useState<WorkflowDefinitionRecord | null>(null);
  const [runWorkflowDialog, setRunWorkflowDialog] =
    useState<WorkflowDefinitionRecord | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    workflow: WorkflowDefinitionRecord;
    input: Record<string, unknown>;
    token: string;
    mode: "start" | "resume";
    runId?: string;
  } | null>(null);
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string>>({});

  const {
    data: workflows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useWorkflowDefinitions();
  const { data: capabilities = [], isLoading: capabilitiesLoading } =
    useCapabilities();
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const createWorkflow = useCreateWorkflowDefinition();
  const deleteWorkflow = useDeleteWorkflowDefinition();
  const updateWorkflow = useUpdateWorkflowDefinition(editingWorkflow?.id ?? "");
  const runWorkflow = useRunWorkflowDefinition();
  const approveWorkflow = useApproveWorkflowRun();
  const trust = useTrust();

  const filtered = useMemo(
    () => workflows.filter((workflow) => workflowMatches(workflow, search)),
    [workflows, search],
  );
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? null,
    [selectedId, workflows],
  );
  const selectedWorkflowSubject = selectedWorkflow
    ? trustSubjectKey("workflow", selectedWorkflow.id)
    : null;
  const selectedTrustLevel = selectedWorkflow
    ? trustLevelForSubject(
        selectedWorkflowSubject
          ? trust.subjects[selectedWorkflowSubject]
          : undefined,
        selectedWorkflow.workflow.runWithoutApproval === true,
      )
    : "approval-required";

  useEffect(() => {
    if (isLoading) return;
    if (filtered.length === 0) {
      if (selectedId) router.replace(BASE_PATH);
      return;
    }
    if (
      selectedId &&
      !filtered.some((workflow) => workflow.id === selectedId)
    ) {
      router.replace(BASE_PATH);
      return;
    }
    if (!selectedId && autoSelectFirst) {
      router.replace(selectionPath(BASE_PATH, filtered[0]!.id));
    }
  }, [autoSelectFirst, filtered, isLoading, router, selectedId]);

  const selectWorkflow = (id: string | null, replace = false) => {
    const path = id ? selectionPath(BASE_PATH, id) : BASE_PATH;
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title="Workflows"
        icon={Workflow}
        iconClassName="text-cyan-400"
        subtitle={`${workflows.length} ${
          workflows.length === 1 ? "workflow" : "workflows"
        }`}
        error={
          error ? `Failed to load workflows: ${(error as Error).message}` : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search workflows..."
        searchAriaLabel="Search workflows"
        accent="teal"
        hasSelection={!!selectedWorkflow}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh workflows"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreateOpen(true)}
              title="New workflow"
              aria-label="New workflow"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedWorkflow ? (
            <WorkflowDetail
              workflow={selectedWorkflow}
              trustLevel={selectedTrustLevel}
              trustPending={trust.isMutating}
              onBack={() => selectWorkflow(null)}
              onRun={async () => {
                setRunWorkflowDialog(selectedWorkflow);
              }}
              onResume={async (currentRunId) => {
                const run = await runWorkflow.mutateAsync({
                  id: selectedWorkflow.id,
                  mode: "resume",
                  runId: currentRunId,
                });
                if (run.kind === "approval-required") {
                  if (!run.approvalContext) return;
                  setPendingApproval({
                    workflow: selectedWorkflow,
                    input: run.approvalContext,
                    token: run.approvalToken,
                    mode: "resume",
                    runId: currentRunId,
                  });
                  return;
                }
                setActiveRunIds((current) => ({
                  ...current,
                  [selectedWorkflow.id]: run.runId,
                }));
              }}
              onRetry={async () => {
                setRunWorkflowDialog(selectedWorkflow);
              }}
              runId={activeRunIds[selectedWorkflow.id]}
              onTrustLevelChange={async (level) => {
                if (!selectedWorkflowSubject) return;
                await trust.setTrustLevel({
                  subject: selectedWorkflowSubject,
                  level,
                });
              }}
              runPending={
                runWorkflow.isPending &&
                runWorkflow.variables === selectedWorkflow.id
              }
              onEdit={() => setEditingWorkflow(selectedWorkflow)}
              onDelete={() => setDeletingWorkflow(selectedWorkflow)}
            />
          ) : (
            <EmptyState
              icon={<Workflow />}
              title="Select a workflow"
              hint="Pick one from the list to see and inspect its flow."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Workflow />} title="Loading workflows..." />
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="No workflows yet"
            hint="Create a visual workflow from your available capabilities."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New workflow
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="No matching workflows"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((workflow) => (
              <li key={workflow.id}>
                <WorkflowRow
                  workflow={workflow}
                  isActive={selectedId === workflow.id}
                  onSelect={() => selectWorkflow(workflow.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>
      <WorkflowEditorDialog
        open={createOpen}
        capabilities={capabilities}
        capabilitiesLoading={capabilitiesLoading}
        agents={agents}
        agentsLoading={agentsLoading}
        saving={createWorkflow.isPending}
        onOpenChange={setCreateOpen}
        onSubmit={async (payload) => {
          const created = await createWorkflow.mutateAsync(payload);
          setCreateOpen(false);
          selectWorkflow(created.id);
        }}
      />
      <WorkflowRunDialog
        workflow={runWorkflowDialog}
        pending={runWorkflow.isPending}
        onClose={() => setRunWorkflowDialog(null)}
        onSubmit={async (input) => {
          if (!runWorkflowDialog) return;
          const workflow = runWorkflowDialog;
          const result = await runWorkflow.mutateAsync({
            id: workflow.id,
            input,
          });
          setRunWorkflowDialog(null);
          if (result.kind === "approval-required") {
            setPendingApproval({
              workflow,
              input,
              token: result.approvalToken,
              mode: "start",
            });
            return;
          }
          setActiveRunIds((current) => ({
            ...current,
            [workflow.id]: result.runId,
          }));
        }}
      />
      <ConfirmDialog
        open={!!pendingApproval}
        title={`Run ${pendingApproval?.workflow.workflow.name ?? "workflow"}?`}
        description={
          pendingApproval?.mode === "resume"
            ? "Kody is ready to publish. Approve this exact content and resume the run."
            : "This workflow requires your approval before Kody Engine can start it."
        }
        confirmLabel={
          pendingApproval?.mode === "resume"
            ? "Approve and publish"
            : "Approve and run"
        }
        onClose={() => setPendingApproval(null)}
        onConfirm={() => {
          if (!pendingApproval) return;
          const approval = pendingApproval;
          void approveWorkflow
            .mutateAsync({
              id: approval.workflow.id,
              approvalToken: approval.token,
              input: approval.input,
            })
            .then((approvalId) =>
              runWorkflow.mutateAsync({
                id: approval.workflow.id,
                approvalId,
                ...(approval.mode === "resume"
                  ? { mode: "resume" as const, runId: approval.runId }
                  : { input: approval.input }),
              }),
            )
            .then((run) => {
              if (run.kind !== "accepted") return;
              setActiveRunIds((current) => ({
                ...current,
                [approval.workflow.id]: run.runId,
              }));
            });
        }}
      />
      <ConfirmDialog
        open={!!deletingWorkflow}
        title={
          deletingWorkflow?.source === "store" || deletingWorkflow?.readOnly
            ? `Remove Store workflow ${deletingWorkflow?.id ?? ""}?`
            : `Delete workflow ${deletingWorkflow?.id ?? ""}?`
        }
        description={
          deletingWorkflow?.source === "store" || deletingWorkflow?.readOnly
            ? "This repo will stop using the Store workflow. The Store workflow will not be deleted."
            : "The workflow definition will be removed from this repository."
        }
        confirmLabel={
          deletingWorkflow?.source === "store" || deletingWorkflow?.readOnly
            ? "Remove"
            : "Delete"
        }
        variant="destructive"
        onClose={() => setDeletingWorkflow(null)}
        onConfirm={() => {
          if (!deletingWorkflow) return;
          deleteWorkflow.mutate(deletingWorkflow.id, {
            onSuccess: () => selectWorkflow(null, true),
          });
        }}
      />
      <WorkflowEditorDialog
        open={!!editingWorkflow}
        initial={editingWorkflow ?? undefined}
        capabilities={capabilities}
        capabilitiesLoading={capabilitiesLoading}
        agents={agents}
        agentsLoading={agentsLoading}
        saving={updateWorkflow.isPending}
        onOpenChange={(open) => {
          if (!open) setEditingWorkflow(null);
        }}
        onSubmit={async (payload) => {
          if (!editingWorkflow) return;
          await updateWorkflow.mutateAsync(payload);
          setEditingWorkflow(null);
        }}
      />
    </>
  );
}

function WorkflowRow({
  workflow,
  isActive,
  onSelect,
}: {
  workflow: WorkflowDefinitionRecord;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- unstyled clickable list row; Button's flex centering would break the block layout
    <button
      type="button"
      className={cn(
        "block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50",
        isActive && "bg-cyan-500/10",
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-sm font-medium text-foreground">
            {workflow.workflow.name}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {workflow.id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isBuiltInWorkflow(workflow.id) ? (
            <BuiltInWorkflowBadge />
          ) : workflow.source === "store" || workflow.readOnly === true ? (
            <StoreWorkflowBadge />
          ) : null}
        </div>
        <span className="shrink-0 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-200">
          {workflow.workflow.capabilities.length}
        </span>
      </div>
    </button>
  );
}

function WorkflowDetail({
  workflow,
  trustLevel,
  trustPending,
  onBack,
  onRun,
  onResume,
  onRetry,
  runId,
  onTrustLevelChange,
  runPending,
  onEdit,
  onDelete,
}: {
  workflow: WorkflowDefinitionRecord;
  trustLevel: TrustLevel;
  trustPending: boolean;
  onBack: () => void;
  onRun: () => void | Promise<void>;
  onResume: (runId: string) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  runId?: string;
  onTrustLevelChange: (level: TrustLevel) => void | Promise<void>;
  runPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const storeBacked = workflow.source === "store" || workflow.readOnly === true;
  const builtIn = isBuiltInWorkflow(workflow.id);
  const runnable = workflow.runnable === true;
  const graph = useMemo(
    () => workflowDefinitionGraph(workflow.workflow),
    [workflow.workflow],
  );
  const { data: latestRun } = useWorkflowRunState(workflow.id, runId);
  const { data: triggers = [] } = useQuery({
    queryKey: ["workflow-event-triggers", workflow.id],
    queryFn: async () =>
      (
        await handleResponse<{
          triggers: Array<{
            id: string;
            name: string;
            enabled: boolean;
            event: string;
            action:
              | { type: "start-workflow"; workflowId: string }
              | { type: "save-user-state" };
          }>;
        }>(
          await fetch("/api/kody/triggers", {
            headers: buildHeaders(),
            cache: "no-store",
          }),
        )
      ).triggers,
  });
  const workflowTriggers = triggers.filter(
    (trigger) =>
      trigger.enabled &&
      trigger.action.type === "start-workflow" &&
      trigger.action.workflowId === workflow.id,
  );
  const latestRunId = latestRun?.runId;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 gap-1 md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {latestRun &&
          latestRun.state.status !== "running" &&
          latestRun.state.status !== "done" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onResume(latestRunId!)}
                disabled={runPending}
              >
                Resume
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onRetry()}
                disabled={runPending}
              >
                Retry
              </Button>
            </>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <Workflow className="h-5 w-5 shrink-0 text-cyan-300" />
            <h2 className="truncate text-xl font-semibold text-foreground">
              {workflow.workflow.name}
            </h2>
            {storeBacked ? <StoreWorkflowBadge /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{workflow.id}</span>
            <span>·</span>
            <span>Agent: {workflow.workflow.agent}</span>
            {workflow.htmlUrl ? (
              <>
                <span>·</span>
                <a
                  href={workflow.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  GitHub
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <TrustLevelControl
            value={trustLevel}
            pending={trustPending}
            onChange={(level) => void onTrustLevelChange(level)}
          />
          <Button
            size="sm"
            onClick={() => void onRun()}
            disabled={!runnable || runPending}
            title={
              runnable ? "Run workflow now" : "Workflow is not available to run"
            }
            aria-label={`Run workflow ${workflow.id}`}
          >
            {runPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run
          </Button>
          {!storeBacked ? (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null}
          {!builtIn ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              aria-label={`${storeBacked ? "Remove" : "Delete"} workflow ${workflow.id}`}
            >
              <Trash2 className="h-4 w-4" />
              {storeBacked ? "Remove" : "Delete"}
            </Button>
          ) : null}
        </div>
      </div>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Route className="h-4 w-4 text-cyan-300" />
            Workflow
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {workflow.workflow.capabilities.length}
          </span>
        </div>
        <WorkflowGraphCanvas
          graph={graph}
          runId={latestRun?.runId}
          runState={latestRun?.state}
        />
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">Starts when</div>
          <Link
            href="/triggers"
            className="text-xs text-cyan-300 hover:text-cyan-200"
          >
            Manage event rules
          </Link>
        </div>
        {workflowTriggers.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {workflowTriggers.map((trigger) => (
              <li key={trigger.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{trigger.event}</span>
                <span className="text-xs text-muted-foreground">
                  ({trigger.name})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No event rules start this Workflow.
          </p>
        )}
      </section>

      <div className="text-xs text-muted-foreground">
        Updated {formatDate(workflow.workflow.updatedAt)}
      </div>
    </div>
  );
}

function StoreWorkflowBadge() {
  return (
    <span className="shrink-0 rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
      Store
    </span>
  );
}

function BuiltInWorkflowBadge() {
  return (
    <span className="shrink-0 rounded border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-200">
      Built in
    </span>
  );
}
