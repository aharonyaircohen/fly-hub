"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kody-ade/base/ui/select";
import { Textarea } from "@kody-ade/base/ui/textarea";
import {
  memoryApi,
  type CreateMemoryInput,
  type Memory,
  type MemoryKind,
} from "@dashboard/lib/api/memory";
import { MEMORY_KINDS } from "../lib/memory-files";
import type { ApiAuthContext } from "@dashboard/lib/api/client";

interface MemoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (memory: Readonly<Memory>) => void;
  memory?: Readonly<Memory> | null;
  allowRepositoryScope?: boolean;
  fixedScope?: "user" | "repository";
  authOverride?: ApiAuthContext | null;
}

export function MemoryFormDialog({
  open,
  onOpenChange,
  onSaved,
  memory = null,
  allowRepositoryScope = true,
  fixedScope,
  authOverride,
}: MemoryFormDialogProps) {
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: CreateMemoryInput = {
      scope: form.get("scope") as "user" | "repository",
      kind: form.get("kind") as MemoryKind,
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
      body: String(form.get("body") ?? ""),
      reason: String(form.get("reason") ?? "") || undefined,
    };
    setSaving(true);
    try {
      const saved = memory
        ? await memoryApi.update(
            memory.id,
            {
              kind: input.kind,
              title: input.title,
              summary: input.summary,
              body: input.body,
              reason: input.reason,
            },
            authOverride,
          )
        : await memoryApi.create(input, authOverride);
      toast.success(memory ? "Memory updated" : "Memory created");
      onSaved(saved);
    } catch (error) {
      toast.error("Could not save memory", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{memory ? "Edit memory" : "New memory"}</DialogTitle>
          <DialogDescription>
            Store one clear fact, preference, decision, or reference.
          </DialogDescription>
        </DialogHeader>
        <form key={memory?.currentRevisionId ?? "new"} onSubmit={submit}>
          <div className="space-y-4">
            {!memory && allowRepositoryScope && !fixedScope ? (
              <Field label="Scope" htmlFor="memory-scope">
                <Select name="scope" defaultValue="user">
                  <SelectTrigger id="memory-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Personal</SelectItem>
                    <SelectItem value="repository">Repository</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Input
                type="hidden"
                name="scope"
                value={memory?.scope.kind ?? fixedScope ?? "user"}
              />
            )}
            <Field label="Kind" htmlFor="memory-kind">
              <Select name="kind" defaultValue={memory?.kind ?? "fact"}>
                <SelectTrigger id="memory-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      <span className="capitalize">{kind}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Title" htmlFor="memory-title">
              <Input
                id="memory-title"
                name="title"
                required
                maxLength={120}
                defaultValue={memory?.content.title}
              />
            </Field>
            <Field label="Summary" htmlFor="memory-summary">
              <Input
                id="memory-summary"
                name="summary"
                required
                maxLength={500}
                defaultValue={memory?.content.summary}
              />
            </Field>
            <Field label="Details" htmlFor="memory-body">
              <Textarea
                id="memory-body"
                name="body"
                required
                rows={7}
                maxLength={20_000}
                defaultValue={memory?.content.body}
              />
            </Field>
            <Field label="Reason" htmlFor="memory-reason">
              <Input
                id="memory-reason"
                name="reason"
                maxLength={500}
                placeholder="Why should Kody keep this?"
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
