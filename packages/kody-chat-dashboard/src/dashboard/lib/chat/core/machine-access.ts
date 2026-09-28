import type { MachineAccess } from "../../chat-types";

export type { MachineAccess } from "../../chat-types";

export interface MachineAvailability {
  local: boolean;
  brain: boolean;
}

export function machineAccessForRuntime(
  stored: MachineAccess | undefined,
  runtime: { kind: string },
): MachineAccess {
  if (stored) return stored;
  return runtime.kind === "brain" ? "brain" : "none";
}

export function availableMachineAccessOptions(
  availability: MachineAvailability,
): MachineAccess[] {
  return [
    "none",
    ...(availability.local ? (["local"] as const) : []),
    ...(availability.brain ? (["brain"] as const) : []),
  ];
}

export interface MachineSelectableEntry {
  agentId: string;
  modelId?: string | null;
}

function isBrainEntry(entry: MachineSelectableEntry): boolean {
  return entry.agentId === "brain" || entry.agentId === "brain-fly";
}

export function modelEntriesForMachineAccess<T extends MachineSelectableEntry>(
  entries: readonly T[],
  machineAccess: MachineAccess,
): T[] {
  if (machineAccess === "brain") {
    return entries.filter(isBrainEntry);
  }
  if (machineAccess === "local") {
    return entries.filter((entry) => entry.agentId === "kody");
  }
  return entries.filter((entry) => !isBrainEntry(entry));
}

export function machineAccessForEntrySelection(
  entry: MachineSelectableEntry,
  current: MachineAccess,
): MachineAccess {
  if (isBrainEntry(entry)) return "brain";
  if (current === "local" && entry.agentId === "kody") return "local";
  return "none";
}
