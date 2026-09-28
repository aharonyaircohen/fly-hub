import { describe, expect, it, vi } from "vitest";

const machines = vi.hoisted(() => ({
  list: vi.fn(),
  rows: vi.fn(),
}));
const brain = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@kody-ade/fly/infrastructure/server-machines", () => ({
  listServerProviderInventory: vi.fn(),
  listServerProviderMachines: machines.list,
  rowsForServerProviderApp: machines.rows,
  emptyServerProviderInventory: () => ({ machines: [], running: 0, total: 0 }),
  refreshServerProviderInventoryCounts: (inventory: {
    machines: Array<{ state: string }>;
  }) => ({
    ...inventory,
    running: inventory.machines.filter((machine) => machine.state === "started")
      .length,
    total: inventory.machines.length,
  }),
}));
vi.mock("@kody-ade/fly/infrastructure/server-brain", () => ({
  resolveSavedBrainServiceForRequest: brain.resolve,
  applySavedBrainMachineToInventory: vi.fn(),
  emptyServerProviderInventory: () => ({ machines: [], running: 0, total: 0 }),
  refreshServerProviderInventoryCounts: (inventory: unknown) => inventory,
}));

import { loadTerminalInventoryAuthority } from "@kody-ade/fly/terminal/server-inventory";

describe("terminal inventory authority", () => {
  it("refreshes a saved Brain machine instead of trusting its persisted state", async () => {
    brain.resolve.mockResolvedValue({
      flyToken: "brain-token",
      brain: {
        app: "brain-app",
        orgSlug: "brain-org",
        defaultRegion: "fra",
        machine: {
          app: "brain-app",
          machineId: "brain-1",
          feature: "brain",
          state: "started",
          label: "Brain",
        },
      },
    });
    machines.list.mockResolvedValue([{ id: "brain-1", state: "suspended" }]);
    machines.rows.mockReturnValue([
      {
        app: "brain-app",
        machineId: "brain-1",
        feature: "brain",
        state: "suspended",
        label: "Brain",
      },
    ]);

    const result = await loadTerminalInventoryAuthority(
      {} as never,
      { token: "repo-token", orgSlug: "repo-org", defaultRegion: "iad" },
      { brainRequested: true },
    );

    expect(machines.list).toHaveBeenCalledWith("brain-app", {
      token: "brain-token",
      orgSlug: "brain-org",
      defaultRegion: "fra",
    });
    expect(result.inventory.machines[0]).toMatchObject({
      machineId: "brain-1",
      state: "suspended",
    });
  });
});
