"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ExternalLink,
  Pencil,
  Play,
  Route,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import type { TrustLevel } from "@dashboard/lib/cto/trust-state";
import { usePipelineRuns } from "@dashboard/lib/hooks/usePipelines";
import type { PipelineDefinitionRecord } from "@dashboard/lib/pipeline-definitions";
import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";
import { buildHeaders, handleResponse } from "@dashboard/lib/api";
import { TrustLevelControl } from "@dashboard/lib/components/TrustLevelControl";

interface PipelineTrigger {
  id: string;
  name: string;
  enabled: boolean;
  action: { type: string; pipelineId?: string };
}

export function PipelineDetail(props: {
  pipeline: PipelineDefinitionRecord;
  workflows: WorkflowDefinitionRecord[];
  onBack(): void;
  onRun(): void;
  onEdit(): void;
  onDelete(): void;
  trustLevel: TrustLevel;
  trustPending: boolean;
  onTrustLevelChange(level: TrustLevel): void | Promise<void>;
}) {
  const runs = usePipelineRuns(props.pipeline.id);
  const latest = runs.data?.[0];
  const [triggers, setTriggers] = useState<PipelineTrigger[]>([]);
  const workflowNames = useMemo(
    () =>
      new Map(
        props.workflows.map((workflow) => [
          workflow.id,
          workflow.workflow.name,
        ]),
      ),
    [props.workflows],
  );

  useEffect(() => {
    void fetch("/api/kody/triggers", {
      headers: buildHeaders(),
      cache: "no-store",
    })
      .then((response) =>
        handleResponse<{ triggers: PipelineTrigger[] }>(response),
      )
      .then((result) => setTriggers(result.triggers))
      .catch(() => undefined);
  }, [props.pipeline.id]);

  const pipelineTriggers = triggers.filter(
    (trigger) =>
      trigger.enabled &&
      trigger.action.type === "start-pipeline" &&
      trigger.action.pipelineId === props.pipeline.id,
  );
  const storeBacked =
    props.pipeline.source === "store" || props.pipeline.readOnly;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 gap-1 md:hidden"
            onClick={props.onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-violet-300" />
            <h2 className="truncate text-xl font-semibold">
              {props.pipeline.pipeline.name}
            </h2>
            {storeBacked ? (
              <span className="rounded border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] uppercase text-violet-300">
                Store
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{props.pipeline.id}</span>
            {props.pipeline.htmlUrl ? (
              <a
                href={props.pipeline.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                Store
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TrustLevelControl
            value={props.trustLevel}
            pending={props.trustPending}
            onChange={props.onTrustLevelChange}
          />
          <Button size="sm" onClick={props.onRun}>
            <Play className="h-4 w-4" />
            Run
          </Button>
          {!storeBacked ? (
            <Button variant="outline" size="sm" onClick={props.onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" onClick={props.onDelete}>
            <Trash2 className="h-4 w-4" />
            {storeBacked ? "Remove" : "Delete"}
          </Button>
        </div>
      </div>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium">Workflow order</span>
          <span className="text-xs text-muted-foreground">
            {props.pipeline.pipeline.steps.length}
          </span>
        </div>
        <ol className="space-y-2">
          {props.pipeline.pipeline.steps.map((step, index) => (
            <li
              key={step.id}
              className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-xs font-medium text-violet-300">
                {index + 1}
              </span>
              <Workflow className="h-4 w-4 text-cyan-300" />
              <Link
                href={`/workflows/${step.workflow}`}
                className="text-sm hover:underline"
              >
                {workflowNames.get(step.workflow) ?? step.workflow}
              </Link>
              {index < props.pipeline.pipeline.steps.length - 1 ? (
                <ArrowDown className="ml-auto h-4 w-4 text-muted-foreground" />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Latest run</span>
          {latest ? (
            <span className="text-xs capitalize text-muted-foreground">
              {latest.status}
            </span>
          ) : null}
        </div>
        {latest ? (
          <ol className="space-y-2">
            {latest.steps.map((step) => (
              <li
                key={step.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {workflowNames.get(step.workflowId) ?? step.workflowId}
                </span>
                <span className="capitalize text-muted-foreground">
                  {step.status}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            This Pipeline has not run yet.
          </p>
        )}
        {latest?.error ? (
          <p className="mt-3 text-sm text-destructive">{latest.error}</p>
        ) : null}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Starts when</span>
          <Link
            href="/triggers"
            className="text-xs text-violet-300 hover:underline"
          >
            Manage triggers
          </Link>
        </div>
        {pipelineTriggers.length ? (
          <ul className="space-y-2 text-sm">
            {pipelineTriggers.map((trigger) => (
              <li key={trigger.id}>{trigger.name}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No triggers start this Pipeline.
          </p>
        )}
      </section>
    </div>
  );
}
