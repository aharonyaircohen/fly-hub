"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import type { PipelineDefinitionInput, PipelineDefinitionRecord } from "@dashboard/lib/pipeline-definitions";
import type { WorkflowDefinitionRecord } from "@dashboard/lib/workflow-definitions";

type Step = { id: string; workflow: string };

export function PipelineEditorDialog(props: {
  open: boolean;
  initial?: PipelineDefinitionRecord;
  workflows: WorkflowDefinitionRecord[];
  saving: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(input: PipelineDefinitionInput): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [workflowToAdd, setWorkflowToAdd] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setName(props.initial?.pipeline.name ?? "");
    setSteps(props.initial?.pipeline.steps.map((step) => ({ ...step })) ?? []);
    setWorkflowToAdd(props.workflows[0]?.id ?? "");
    setError("");
  }, [props.initial, props.open, props.workflows]);

  const add = () => {
    if (!workflowToAdd) return;
    const count = steps.filter((step) => step.workflow === workflowToAdd).length;
    setSteps((current) => [
      ...current,
      {
        id: count ? `${workflowToAdd}-${count + 1}` : workflowToAdd,
        workflow: workflowToAdd,
      },
    ]);
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...steps];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSteps(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Give the Pipeline a name.");
    if (!steps.length) return setError("Add at least one Workflow.");
    const first = props.workflows.find((workflow) => workflow.id === steps[0]!.workflow);
    await props.onSubmit({
      name: name.trim(),
      ...(props.initial?.pipeline.inputSchema || first?.workflow.inputSchema
        ? { inputSchema: props.initial?.pipeline.inputSchema ?? first?.workflow.inputSchema }
        : {}),
      steps,
      runWithoutApproval: props.initial?.pipeline.runWithoutApproval,
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.initial ? "Edit Pipeline" : "New Pipeline"}</DialogTitle>
          <DialogDescription>Choose the Workflows and the order they run.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="pipeline-name">Pipeline name</Label>
            <Input id="pipeline-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-workflow">Workflow to add</Label>
            <div className="flex gap-2">
              <select
                id="pipeline-workflow"
                className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                value={workflowToAdd}
                onChange={(event) => setWorkflowToAdd(event.target.value)}
              >
                {props.workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>{workflow.workflow.name}</option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={add} disabled={!workflowToAdd}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const workflow = props.workflows.find((candidate) => candidate.id === step.workflow);
              return (
                <li key={step.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-medium text-violet-300">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{workflow?.workflow.name ?? step.workflow}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move ${step.workflow} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move ${step.workflow} down`} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${step.workflow}`} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                </li>
              );
            })}
          </ol>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={props.saving}>{props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
