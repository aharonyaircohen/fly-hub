"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
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
import { validateWorkflowInput } from "@dashboard/lib/workflow-definitions";
import type { WorkflowInputSchema } from "@dashboard/lib/workflow-input-schema";
import {
  parseWorkflowRunInput,
  workflowRunInputForm,
} from "@dashboard/features/workflows/workflow-run-input-form";

export function RunInputDialog(props: {
  open: boolean;
  name: string;
  itemLabel: "Pipeline" | "Workflow";
  inputSchema?: WorkflowInputSchema;
  pending: boolean;
  onClose(): void;
  onSubmit(input: Record<string, unknown>): Promise<void>;
}) {
  const inputForm = useMemo(
    () => workflowRunInputForm(props.inputSchema),
    [props.inputSchema],
  );
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [jsonInput, setJsonInput] = useState("{}");
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!props.open) return;
    setValues({});
    setJsonInput("{}");
    setErrors([]);
  }, [props.open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let input: Record<string, unknown>;
    try {
      input = parseWorkflowRunInput(inputForm, values, jsonInput);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Input is invalid."]);
      return;
    }
    const issues = validateWorkflowInput(input, props.inputSchema);
    if (issues.length) {
      setErrors(issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    await props.onSubmit(input);
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run {props.name || props.itemLabel}</DialogTitle>
          <DialogDescription>
            Enter the information this {props.itemLabel.toLowerCase()} needs.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {inputForm.kind === "json" ? (
            <div className="space-y-2">
              <Label htmlFor="run-input-json">Input (JSON)</Label>
              <textarea
                id="run-input-json"
                className="min-h-32 w-full rounded-md border border-border bg-background p-3 font-mono text-sm"
                value={jsonInput}
                onChange={(event) => setJsonInput(event.target.value)}
              />
            </div>
          ) : (
            inputForm.fields.map((field) => (
              <div className="space-y-2" key={field.name}>
                <Label htmlFor={`run-input-${field.name}`}>
                  {field.name}{field.required ? " *" : ""}
                </Label>
                {field.type === "boolean" ? (
                  <Checkbox
                    id={`run-input-${field.name}`}
                    checked={values[field.name] === true}
                    onCheckedChange={(checked) =>
                      setValues((current) => ({ ...current, [field.name]: checked === true }))
                    }
                  />
                ) : (
                  <Input
                    id={`run-input-${field.name}`}
                    type={field.type === "integer" || field.type === "number" ? "number" : "text"}
                    min={field.minimum}
                    step={field.type === "integer" ? 1 : undefined}
                    required={field.required}
                    value={String(values[field.name] ?? "")}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))
          )}
          {errors.length ? (
            <ul className="space-y-1 text-sm text-destructive">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button type="submit" disabled={props.pending}>
              {props.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
