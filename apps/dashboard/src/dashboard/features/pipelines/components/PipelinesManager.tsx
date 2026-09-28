/**
 * @fileType component
 * @domain kody
 * @pattern pipelines-manager
 * @ai-summary First-class Pipeline management using the same master-detail
 *   shell, trust controls, run input, and delete behavior as Workflows.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw, Route } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { useTrust } from "@dashboard/lib/cto/useTrust";
import {
  trustLevelForSubject,
  trustSubjectKey,
} from "@dashboard/lib/cto/trust-state";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
import {
  useApprovePipelineRun,
  useCreatePipelineDefinition,
  useDeletePipelineDefinition,
  usePipelineDefinitions,
  useRunPipeline,
  useUpdatePipelineDefinition,
} from "@dashboard/lib/hooks/usePipelines";
import { useWorkflowDefinitions } from "@dashboard/lib/hooks/useWorkflowDefinitions";
import type { PipelineDefinitionRecord } from "@dashboard/lib/pipeline-definitions";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { cn } from "@dashboard/lib/utils";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { MasterDetailShell } from "@dashboard/lib/components/MasterDetailShell";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { RunInputDialog } from "@dashboard/features/workflows/components/RunInputDialog";
import { PipelineEditorDialog } from "./PipelineEditorDialog";
import { PipelineDetail } from "./PipelineDetail";

const BASE_PATH = "/pipelines";

function matches(pipeline: PipelineDefinitionRecord, search: string): boolean {
  const query = search.trim().toLowerCase();
  return (
    !query ||
    [
      pipeline.id,
      pipeline.pipeline.name,
      ...pipeline.pipeline.steps.map((step) => step.workflow),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

export function PipelinesManager({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PipelineDefinitionRecord | null>(null);
  const [deleting, setDeleting] = useState<PipelineDefinitionRecord | null>(
    null,
  );
  const [running, setRunning] = useState<PipelineDefinitionRecord | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    pipeline: PipelineDefinitionRecord;
    input: Record<string, unknown>;
    token: string;
  } | null>(null);

  const pipelinesQuery = usePipelineDefinitions();
  const workflowsQuery = useWorkflowDefinitions();
  const pipelines = useMemo(
    () => pipelinesQuery.data ?? [],
    [pipelinesQuery.data],
  );
  const workflows = workflowsQuery.data ?? [];
  const create = useCreatePipelineDefinition();
  const update = useUpdatePipelineDefinition(editing?.id ?? "");
  const remove = useDeletePipelineDefinition();
  const run = useRunPipeline();
  const approve = useApprovePipelineRun();
  const trust = useTrust();

  const filtered = useMemo(
    () => pipelines.filter((pipeline) => matches(pipeline, search)),
    [pipelines, search],
  );
  const selected = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedId) ?? null,
    [pipelines, selectedId],
  );

  useEffect(() => {
    if (pipelinesQuery.isLoading) return;
    if (!filtered.length) {
      if (selectedId) router.replace(BASE_PATH);
      return;
    }
    if (
      selectedId &&
      !filtered.some((pipeline) => pipeline.id === selectedId)
    ) {
      router.replace(BASE_PATH);
      return;
    }
    if (!selectedId && autoSelectFirst)
      router.replace(selectionPath(BASE_PATH, filtered[0]!.id));
  }, [autoSelectFirst, filtered, pipelinesQuery.isLoading, router, selectedId]);

  const select = (id: string | null, replace = false) => {
    const path = id ? selectionPath(BASE_PATH, id) : BASE_PATH;
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title="Pipelines"
        icon={Route}
        iconClassName="text-violet-400"
        subtitle={`${pipelines.length} ${pipelines.length === 1 ? "Pipeline" : "Pipelines"}`}
        error={
          pipelinesQuery.error
            ? `Failed to load Pipelines: ${(pipelinesQuery.error as Error).message}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search Pipelines..."
        searchAriaLabel="Search Pipelines"
        accent="violet"
        hasSelection={!!selected}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void pipelinesQuery.refetch()}
              disabled={pipelinesQuery.isFetching}
            >
              {pipelinesQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Pipeline
            </Button>
          </>
        }
        detail={
          selected ? (
            <PipelineDetail
              pipeline={selected}
              workflows={workflows}
              onBack={() => select(null)}
              onRun={() => setRunning(selected)}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
              trustLevel={trustLevelForSubject(
                trust.subjects[trustSubjectKey("pipeline", selected.id)],
                selected.pipeline.runWithoutApproval === true,
              )}
              trustPending={trust.isMutating}
              onTrustLevelChange={(level) =>
                trust.setTrustLevel({
                  subject: trustSubjectKey("pipeline", selected.id),
                  level,
                })
              }
            />
          ) : (
            <EmptyState
              icon={<Route />}
              title="Select a Pipeline"
              hint="Pick one to inspect its Workflow sequence."
            />
          )
        }
      >
        {pipelinesQuery.isLoading ? (
          <EmptyState icon={<Route />} title="Loading Pipelines..." />
        ) : pipelines.length === 0 ? (
          <EmptyState
            icon={<Route />}
            title="No Pipelines yet"
            hint="Create a Pipeline from reusable Workflows."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New Pipeline
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Route />} title="No matching Pipelines" />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((pipeline) => (
              <li key={pipeline.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto w-full justify-start rounded-none px-4 py-3 text-left hover:bg-accent/50",
                    selectedId === pipeline.id && "bg-violet-500/10",
                  )}
                  onClick={() => select(pipeline.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {pipeline.pipeline.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {pipeline.id}
                      </div>
                    </div>
                    <span className="rounded border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300">
                      {pipeline.pipeline.steps.length}
                    </span>
                  </div>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <PipelineEditorDialog
        open={createOpen}
        workflows={workflows}
        saving={create.isPending}
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          const created = await create.mutateAsync(input);
          setCreateOpen(false);
          select(created.id);
        }}
      />
      <PipelineEditorDialog
        open={!!editing}
        initial={editing ?? undefined}
        workflows={workflows}
        saving={update.isPending}
        onOpenChange={(open) => !open && setEditing(null)}
        onSubmit={async (input) => {
          await update.mutateAsync(input);
          setEditing(null);
        }}
      />
      <RunInputDialog
        open={!!running}
        name={running?.pipeline.name ?? "Pipeline"}
        itemLabel="Pipeline"
        inputSchema={running?.pipeline.inputSchema}
        pending={run.isPending}
        onClose={() => setRunning(null)}
        onSubmit={async (input) => {
          if (!running) return;
          const pipeline = running;
          try {
            const result = await run.mutateAsync({
              id: pipeline.id,
              data: input,
            });
            if ("error" in result && result.error === "approval_required") {
              setPendingApproval({
                pipeline,
                input,
                token: result.approvalToken,
              });
            }
          } finally {
            setRunning(null);
          }
        }}
      />
      <ConfirmDialog
        open={!!pendingApproval}
        title={`Run ${pendingApproval?.pipeline.pipeline.name ?? "Pipeline"}?`}
        description="This Pipeline requires your approval before it starts."
        confirmLabel="Approve and run"
        onClose={() => setPendingApproval(null)}
        onConfirm={() => {
          if (!pendingApproval) return;
          const pending = pendingApproval;
          void approve
            .mutateAsync({
              id: pending.pipeline.id,
              approvalToken: pending.token,
              data: pending.input,
            })
            .then((approvalId) =>
              run.mutateAsync({
                id: pending.pipeline.id,
                data: pending.input,
                approvalId,
              }),
            )
            .then(() => setPendingApproval(null));
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title={`${deleting?.readOnly ? "Remove Store" : "Delete"} Pipeline ${deleting?.id ?? ""}?`}
        description={
          deleting?.readOnly
            ? "This repository will stop using the Store Pipeline."
            : "The Pipeline will be removed from this repository."
        }
        confirmLabel={deleting?.readOnly ? "Remove" : "Delete"}
        variant="destructive"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              select(null, true);
            },
          });
        }}
      />
    </>
  );
}
