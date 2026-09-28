"use client";

import { useRef, useState } from "react";
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

type Size = "low" | "medium" | "high";
const sizes: Array<{ value: Size; label: string; detail: string }> = [
  { value: "low", label: "Economy", detail: "shared 2× · 2 GB" },
  { value: "medium", label: "Balanced", detail: "performance 1× · 2 GB" },
  { value: "high", label: "Fast", detail: "performance 2× · 4 GB" },
];

export interface CreatedFlyMachine {
  app: string;
  machineId: string;
  region: string;
  state: string;
}

export function FlyMachineCreateDialog({
  open,
  onOpenChange,
  headers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headers: Record<string, string>;
  onCreated: (machine: CreatedFlyMachine) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [size, setSize] = useState<Size>("medium");
  const [region, setRegion] = useState("");
  const [sleepWhenIdle, setSleepWhenIdle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError("Enter a machine name.");
      return;
    }
    const regionValue = region.trim().toLowerCase();
    if (regionValue && !/^[a-z]{3,4}$/.test(regionValue)) {
      setError("Enter a valid Fly region, such as ams.");
      return;
    }
    setBusy(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/kody/fly/machines", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          size,
          ...(regionValue ? { region: regionValue } : {}),
          sleepWhenIdle,
          requestId: requestId.current,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as
        Partial<CreatedFlyMachine> & { message?: string; error?: string };
      if (!response.ok || !body.app || !body.machineId) {
        throw new Error(body.message ?? body.error ?? "Could not create machine");
      }
      await onCreated(body as CreatedFlyMachine);
      requestId.current = null;
      setName("");
      setRegion("");
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create machine");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-label="Create machine" className="fly-create-dialog max-w-xl">
        <DialogHeader>
          <DialogTitle>Create machine</DialogTitle>
          <DialogDescription>
            Set up a machine with SSH access. It will appear in Machines when ready.
          </DialogDescription>
        </DialogHeader>
        <div className="fly-create-form">
          <label>
            <span>Machine name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="My machine" autoFocus />
          </label>
          <fieldset>
            <legend>Size</legend>
            <div className="fly-create-form__sizes" role="radiogroup" aria-label="Machine size">
              {sizes.map((option) => (
                <Button key={option.value} type="button" size="clear" variant="ghost" role="radio" aria-checked={size === option.value} className={size === option.value ? "is-selected" : ""} onClick={() => setSize(option.value)}>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </Button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>Region <small>(optional)</small></span>
            <Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Default: iad" autoComplete="off" spellCheck={false} />
          </label>
          <label className="fly-create-form__sleep">
            <Checkbox checked={sleepWhenIdle} onCheckedChange={(checked) => setSleepWhenIdle(checked === true)} />
            <span>Sleep when idle <small>Reduces running costs; wakes for SSH.</small></span>
          </label>
          {error && <p role="alert" className="fly-create-form__error">{error}</p>}
        </div>
        <div className="fly-create-form__actions">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void create()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Creating…" : "Create machine"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
