"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kody-ade/base/ui/select";
import { Textarea } from "@kody-ade/base/ui/textarea";
import { buildHeaders, handleResponse } from "@dashboard/lib/api";
import { useAuth } from "@dashboard/lib/auth-context";
import { EmptyState } from "@dashboard/lib/components/EmptyState";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { MasterDetailShell } from "@dashboard/lib/components/MasterDetailShell";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@dashboard/lib/components/SearchableSelect";
import { useCapabilities } from "@dashboard/lib/hooks/useCapabilities";
import { useWorkflowDefinitions } from "@dashboard/lib/hooks/useWorkflowDefinitions";
import { selectionPath } from "@dashboard/lib/selection-routing";
import { LIVE_SCHEDULE_OPTIONS } from "@dashboard/lib/schedule-options";

type LoopTrigger =
  | { type: "manual" }
  | {
      type: "schedule";
      every: string;
      at?: { time: string; timezone: string };
    }
  | { type: "event" | "webhook"; event: string }
  | { type: "condition"; expression: string };

interface Loop {
  id: string;
  trigger: LoopTrigger;
  target: { kind: "workflow" | "capability"; id: string };
  input: Record<string, unknown>;
  enabled: boolean;
  updatedAt: string;
}

const LOOP_KEY = ["agency-loops"] as const;

export function LoopsPage({
  selectedId = null,
  basePath = "/agent-loops",
}: {
  selectedId?: string | null;
  basePath?: string;
}) {
  const { auth } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Loop | null>(null);
  const [runCandidate, setRunCandidate] = useState<Loop | null>(null);
  const [search, setSearch] = useState("");
  const loops = useQuery({
    queryKey: LOOP_KEY,
    queryFn: async () =>
      (
        await handleResponse<{ loops: Loop[] }>(
          await fetch("/api/kody/loops", {
            headers: buildHeaders(),
            cache: "no-store",
          }),
        )
      ).loops,
    enabled: !!auth,
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      handleResponse(
        await fetch(`/api/kody/loops/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: buildHeaders(),
        }),
      ),
    onSuccess: () => {
      router.push(basePath);
      void queryClient.invalidateQueries({ queryKey: LOOP_KEY });
      toast.success("Loop deleted");
    },
    onError: (error: Error) =>
      toast.error("Could not delete loop", { description: error.message }),
  });
  const toggleEnabled = useMutation({
    mutationFn: async (loop: Loop) =>
      handleResponse(
        await fetch(`/api/kody/loops/${encodeURIComponent(loop.id)}`, {
          method: "PATCH",
          headers: buildHeaders(),
          body: JSON.stringify({
            trigger: loop.trigger,
            target: loop.target,
            input: loop.input,
            enabled: !loop.enabled,
          }),
        }),
      ),
    onSuccess: (_data, loop) => {
      void queryClient.invalidateQueries({ queryKey: LOOP_KEY });
      toast.success(loop.enabled ? "Loop disabled" : "Loop enabled");
    },
    onError: (error: Error) =>
      toast.error("Could not update loop", { description: error.message }),
  });
  const runLoop = useMutation({
    mutationFn: async (loop: Loop) =>
      handleResponse<{ runId: string }>(
        await fetch(`/api/kody/loops/${encodeURIComponent(loop.id)}/run`, {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({ approved: true }),
        }),
      ),
    onSuccess: (result) =>
      toast.success("Loop started", {
        description: `Run ${result.runId} accepted by Kody Engine.`,
      }),
    onError: (error: Error) =>
      toast.error("Could not run Loop", { description: error.message }),
  });
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (loops.data ?? []).filter(
      (loop) =>
        !query ||
        loop.id.toLowerCase().includes(query) ||
        loop.target.id.toLowerCase().includes(query) ||
        triggerLabel(loop.trigger).toLowerCase().includes(query),
    );
  }, [loops.data, search]);
  const selected = (loops.data ?? []).find((loop) => loop.id === selectedId);

  return (
    <>
      <MasterDetailShell
        title="Loops"
        icon={History}
        iconClassName="text-emerald-400"
        subtitle={`${loops.data?.length ?? 0} recurring triggers`}
        error={loops.error instanceof Error ? loops.error.message : null}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search loops..."
        searchAriaLabel="Search loops"
        accent="emerald"
        hasSelection={!!selected}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh loops"
              disabled={loops.isFetching}
              onClick={() => void loops.refetch()}
            >
              <RefreshCw
                className={`h-4 w-4 ${loops.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              aria-label="New loop"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selected ? (
            <LoopDetail
              loop={selected}
              onBack={() => router.push(basePath)}
              onEdit={() => setEditing(selected)}
              onToggle={() => toggleEnabled.mutate(selected)}
              onDelete={() => remove.mutate(selected.id)}
              onRun={() => setRunCandidate(selected)}
              toggling={toggleEnabled.isPending}
              deleting={remove.isPending}
              running={runLoop.isPending}
            />
          ) : (
            <EmptyState
              icon={<History />}
              title="Select a loop"
              hint="See what triggers it and which workflow or capability it starts."
            />
          )
        }
      >
        {loops.isLoading ? (
          <EmptyState icon={<History />} title="Loading loops..." />
        ) : filtered.length ? (
          <ul className="divide-y divide-border">
            {filtered.map((loop) => (
              <li key={loop.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="clear"
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  onClick={() => router.push(selectionPath(basePath, loop.id))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-medium">
                      {loop.id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {loop.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {triggerLabel(loop.trigger)} → {loop.target.id}
                  </p>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<History />}
            title={search ? "No matching loops" : "No loops yet"}
            hint={
              search ? "Try another search." : "Create one recurring trigger."
            }
          />
        )}
      </MasterDetailShell>

      <ConfirmDialog
        open={!!runCandidate}
        title={`Run ${runCandidate?.id ?? "Loop"} now?`}
        description="This starts only this Loop through Kody Engine and may update repository state."
        confirmLabel="Approve and run"
        onClose={() => setRunCandidate(null)}
        onConfirm={() => {
          if (runCandidate) runLoop.mutate(runCandidate);
        }}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New loop</DialogTitle>
            <DialogDescription>
              Choose when it runs and what it starts.
            </DialogDescription>
          </DialogHeader>
          <LoopForm
            key="new-loop"
            onSaved={(id) => {
              setCreating(false);
              void queryClient.invalidateQueries({ queryKey: LOOP_KEY });
              router.push(selectionPath(basePath, id));
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit loop</DialogTitle>
            <DialogDescription>
              Change when it runs and what it starts.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <LoopForm
              key={editing.id}
              loop={editing}
              onSaved={() => {
                setEditing(null);
                void queryClient.invalidateQueries({ queryKey: LOOP_KEY });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LoopDetail({
  loop,
  onBack,
  onEdit,
  onToggle,
  onDelete,
  onRun,
  toggling,
  deleting,
  running,
}: {
  loop: Loop;
  onBack: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRun: () => void;
  toggling: boolean;
  deleting: boolean;
  running: boolean;
}) {
  return (
    <article className="mx-auto max-w-4xl space-y-7 p-5 md:p-8">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 md:hidden"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to loops
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-semibold">{loop.id}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {loop.enabled ? "Enabled" : "Disabled"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onRun}
              disabled={!loop.enabled || running}
              aria-label={`Run Loop ${loop.id}`}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              disabled={toggling}
            >
              {toggling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : loop.enabled ? (
                <PowerOff className="h-4 w-4" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              {loop.enabled ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        </div>
      </div>

      <dl className="grid gap-6 border-y border-border py-6 sm:grid-cols-2">
        <Detail label="Trigger" value={triggerLabel(loop.trigger)} />
        <Detail
          label="Target"
          value={`${loop.target.kind}/${loop.target.id}`}
        />
        <Detail label="Input" value={JSON.stringify(loop.input)} mono />
        <Detail
          label="Updated"
          value={new Date(loop.updatedAt).toLocaleString()}
        />
      </dl>

      <div className="flex justify-end border-t border-border pt-6">
        <Button
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete loop
        </Button>
      </div>
    </article>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function LoopForm({
  loop,
  onSaved,
}: {
  loop?: Loop;
  onSaved: (id: string) => void;
}) {
  const scheduleTrigger =
    loop?.trigger.type === "schedule" ? loop.trigger : null;
  const [id, setId] = useState(loop?.id ?? "");
  const [triggerType, setTriggerType] = useState<LoopTrigger["type"]>(
    loop?.trigger.type ?? "schedule",
  );
  const [every, setEvery] = useState(scheduleTrigger?.every ?? "1d");
  const [preferredTime, setPreferredTime] = useState(
    scheduleTrigger?.at?.time ?? "",
  );
  const [timezone, setTimezone] = useState(
    scheduleTrigger?.at?.timezone ?? browserTimeZone(),
  );
  const [eventName, setEventName] = useState(
    loop?.trigger.type === "event" || loop?.trigger.type === "webhook"
      ? loop.trigger.event
      : "",
  );
  const [condition, setCondition] = useState(
    loop?.trigger.type === "condition" ? loop.trigger.expression : "",
  );
  const [targetKind, setTargetKind] = useState<Loop["target"]["kind"]>(
    loop?.target.kind ?? "workflow",
  );
  const [targetId, setTargetId] = useState<string | null>(
    loop?.target.id ?? null,
  );
  const [input, setInput] = useState(
    JSON.stringify(loop?.input ?? {}, null, 2),
  );
  const [enabled, setEnabled] = useState(loop?.enabled ?? true);
  const capabilities = useCapabilities();
  const workflows = useWorkflowDefinitions();

  const capabilityOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = (capabilities.data ?? []).map(
      (capability) => ({
        value: capability.slug,
        label: capability.describe || capability.slug,
        selectedLabel: capability.slug,
        description: capability.slug,
        searchText: `${capability.slug} ${capability.describe ?? ""}`,
      }),
    );
    if (
      loop?.target.kind === "capability" &&
      !options.some((option) => option.value === loop.target.id)
    ) {
      options.unshift({ value: loop.target.id, label: loop.target.id });
    }
    return options;
  }, [capabilities.data, loop]);
  const workflowOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = (workflows.data ?? []).map(
      (workflow) => ({
        value: workflow.id,
        label: workflow.workflow.name || workflow.id,
        selectedLabel: workflow.id,
        description: workflow.id,
        searchText: `${workflow.id} ${workflow.workflow.name}`,
      }),
    );
    if (
      loop?.target.kind === "workflow" &&
      !options.some((option) => option.value === loop.target.id)
    ) {
      options.unshift({ value: loop.target.id, label: loop.target.id });
    }
    return options;
  }, [loop, workflows.data]);
  const scheduleOptions = useMemo(
    () =>
      LIVE_SCHEDULE_OPTIONS.some((option) => option.value === every)
        ? [...LIVE_SCHEDULE_OPTIONS]
        : [{ value: every, label: every }, ...LIVE_SCHEDULE_OPTIONS],
    [every],
  );
  const save = useMutation({
    mutationFn: async (body: Omit<Loop, "updatedAt">) =>
      handleResponse(
        await fetch(
          loop
            ? `/api/kody/loops/${encodeURIComponent(loop.id)}`
            : "/api/kody/loops",
          {
            method: loop ? "PATCH" : "POST",
            headers: buildHeaders(),
            body: JSON.stringify(body),
          },
        ),
      ),
    onSuccess: () => {
      toast.success(loop ? "Loop updated" : "Loop created");
      onSaved(id);
    },
    onError: (error: Error) =>
      toast.error(loop ? "Could not update loop" : "Could not create loop", {
        description: error.message,
      }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsedInput = JSON.parse(input) as unknown;
      if (
        !parsedInput ||
        typeof parsedInput !== "object" ||
        Array.isArray(parsedInput)
      ) {
        throw new Error("Input must be an object");
      }
      if (!targetId) {
        toast.error("Choose a target.");
        return;
      }
      let trigger: LoopTrigger;
      if (triggerType === "schedule") {
        trigger = {
          type: "schedule",
          every,
          ...(preferredTime
            ? { at: { time: preferredTime, timezone: timezone.trim() } }
            : {}),
        };
      } else if (triggerType === "event" || triggerType === "webhook") {
        trigger = { type: triggerType, event: eventName.trim() };
      } else if (triggerType === "condition") {
        trigger = { type: "condition", expression: condition.trim() };
      } else {
        trigger = { type: "manual" };
      }
      save.mutate({
        id,
        trigger,
        target: { kind: targetKind, id: targetId },
        input: parsedInput as Record<string, unknown>,
        enabled,
      });
    } catch {
      toast.error("Loop input must be a JSON object.");
    }
  };
  const targetOptions =
    targetKind === "workflow" ? workflowOptions : capabilityOptions;
  const targetLoading =
    targetKind === "workflow" ? workflows.isLoading : capabilities.isLoading;

  return (
    <form onSubmit={submit} className="grid gap-4 pt-2 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="loop-id">Loop ID</Label>
        <Input
          id="loop-id"
          required
          pattern="[a-z][a-z0-9-]{0,127}"
          disabled={!!loop}
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="loop-trigger-type">Trigger</Label>
        <Select
          value={triggerType}
          onValueChange={(value) =>
            setTriggerType(value as LoopTrigger["type"])
          }
        >
          <SelectTrigger id="loop-trigger-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="schedule">Schedule</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            {loop?.trigger.type === "event" || loop?.trigger.type === "webhook" ? (
              <SelectItem value={loop.trigger.type} disabled>
                Legacy {loop.trigger.type} (read-only)
              </SelectItem>
            ) : null}
            {loop?.trigger.type === "condition" ? (
              <SelectItem value="condition" disabled>
                Legacy condition (read-only)
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {triggerType === "schedule" ? (
        <div className="space-y-2">
          <Label htmlFor="loop-schedule">Cadence</Label>
          <Select value={every} onValueChange={setEvery}>
            <SelectTrigger id="loop-schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scheduleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : triggerType === "event" || triggerType === "webhook" ? (
        <Field label="Event name" value={eventName} onChange={setEventName} />
      ) : triggerType === "condition" ? (
        <Field label="Condition" value={condition} onChange={setCondition} />
      ) : (
        <div className="flex items-end text-sm text-muted-foreground">
          Runs only when started manually.
        </div>
      )}

      {triggerType === "schedule" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="loop-preferred-time">
              Preferred time (optional)
            </Label>
            <Input
              id="loop-preferred-time"
              type="time"
              value={preferredTime}
              onChange={(event) => setPreferredTime(event.target.value)}
            />
          </div>
          {preferredTime ? (
            <Field label="Timezone" value={timezone} onChange={setTimezone} />
          ) : (
            <div />
          )}
        </>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="loop-target-kind">Target type</Label>
        <Select
          value={targetKind}
          onValueChange={(value) => {
            setTargetKind(value as Loop["target"]["kind"]);
            setTargetId(null);
          }}
        >
          <SelectTrigger id="loop-target-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="workflow">Workflow</SelectItem>
            <SelectItem value="capability">Capability</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor="loop-target">Target</Label>
        <SearchableSelect
          id="loop-target"
          options={targetOptions}
          value={targetId}
          onChange={setTargetId}
          placeholder={
            targetLoading ? `Loading ${targetKind}s...` : `Select ${targetKind}`
          }
          searchPlaceholder={`Search ${targetKind}s...`}
          emptyLabel={`No ${targetKind}s found`}
          disabled={targetLoading}
        />
      </div>

      <details
        className="rounded-md border border-border px-3 py-2 sm:col-span-2"
        open={Object.keys(loop?.input ?? {}).length > 0 || undefined}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Input (optional)
        </summary>
        <div className="space-y-2 pt-3">
          <Label htmlFor="loop-input">JSON object</Label>
          <Textarea
            id="loop-input"
            className="min-h-24 font-mono text-xs"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
      </details>

      <div className="flex items-center gap-2 sm:col-span-2">
        <Checkbox
          id="loop-enabled"
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
        />
        <Label htmlFor="loop-enabled">Enabled</Label>
      </div>

      <div className="flex justify-end sm:col-span-2">
        <Button
          type="submit"
          disabled={
            save.isPending ||
            !id.trim() ||
            !targetId ||
            ((triggerType === "event" || triggerType === "webhook") &&
              !eventName.trim()) ||
            (triggerType === "condition" && !condition.trim()) ||
            (triggerType === "schedule" &&
              (!every || (!!preferredTime && !timezone.trim())))
          }
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loop ? "Save changes" : "Create loop"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function triggerLabel(trigger: Loop["trigger"]) {
  if (trigger.type === "schedule") {
    const at = trigger.at
      ? ` at ${trigger.at.time} ${trigger.at.timezone}`
      : "";
    return `Every ${trigger.every}${at}`;
  }
  if (trigger.type === "event" || trigger.type === "webhook")
    return trigger.event;
  if (trigger.type === "condition") return trigger.expression;
  return "Manual";
}
