import { describe, expect, it } from "vitest";
import {
  availableMachineAccessOptions,
  machineAccessForEntrySelection,
  machineAccessForRuntime,
  modelEntriesForMachineAccess,
  type MachineAccess,
} from "../../../src/dashboard/lib/chat/core/machine-access";
import type { ChatDropdownEntry } from "../../../src/dashboard/lib/chat/platform/agent-entries";

const entries = [
  { key: "kody-live", agentId: "kody-live", modelId: null },
  { key: "brain:model-a", agentId: "brain", modelId: "model-a" },
  { key: "kody:model-b", agentId: "kody", modelId: "model-b" },
] as ChatDropdownEntry[];

describe("machine access", () => {
  it("defaults legacy conversations without a Brain runtime to no access", () => {
    expect(machineAccessForRuntime(undefined, { kind: "direct" })).toBe("none");
    expect(machineAccessForRuntime(undefined, { kind: "live" })).toBe("none");
  });

  it("preserves legacy Brain conversations as Brain machine access", () => {
    expect(machineAccessForRuntime(undefined, { kind: "brain" })).toBe("brain");
  });

  it.each<MachineAccess>(["none", "local", "brain"])(
    "keeps an explicitly stored %s selection",
    (machineAccess) => {
      expect(machineAccessForRuntime(machineAccess, { kind: "brain" })).toBe(
        machineAccess,
      );
    },
  );

  it("only exposes Local and Brain when those machines are available", () => {
    expect(
      availableMachineAccessOptions({ local: false, brain: false }),
    ).toEqual(["none"]);
    expect(availableMachineAccessOptions({ local: true, brain: true })).toEqual(
      ["none", "local", "brain"],
    );
  });

  it("keeps model compatibility separate from machine identity", () => {
    expect(modelEntriesForMachineAccess(entries, "brain")).toEqual([
      expect.objectContaining({ agentId: "brain" }),
    ]);
    expect(modelEntriesForMachineAccess(entries, "local")).toEqual([
      expect.objectContaining({ agentId: "kody" }),
    ]);
    expect(modelEntriesForMachineAccess(entries, "none")).toEqual([
      expect.objectContaining({ agentId: "kody-live" }),
      expect.objectContaining({ agentId: "kody" }),
    ]);
  });

  it("keeps model ownership with the picker when machine access is incompatible", () => {
    expect(machineAccessForEntrySelection(entries[2]!, "brain")).toBe("none");
  });

  it("keeps compatible machine access when the picker changes model", () => {
    expect(machineAccessForEntrySelection(entries[2]!, "local")).toBe("local");
    expect(machineAccessForEntrySelection(entries[1]!, "none")).toBe("brain");
  });
});
