import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vault: vi.fn(),
  createApp: vi.fn(),
  listMachines: vi.fn(),
  createMachine: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("@kody-ade/base/vault/crypto", () => ({ isVaultConfigured: mocks.vault }));
vi.mock("../../src/plugin/previews/machines-client", () => ({
  createApp: mocks.createApp,
  listMachines: mocks.listMachines,
  createMachine: mocks.createMachine,
  waitForMachineStarted: mocks.wait,
}));
import {
  createManagedMachine,
  managedMachineAppName,
  visibleManagedInventory,
} from "../../src/machines/managed";

const cfg = { token: "private", orgSlug: "personal", defaultRegion: "fra" };
const input = {
  owner: "Alice",
  repo: "Demo",
  name: "My Machine",
  size: "high" as const,
  region: "ams",
  sleepWhenIdle: true,
  requestId: "f972134a-1b3e-462a-8cda-20165967f9c7",
  cfg,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.vault.mockReturnValue(true);
  mocks.listMachines
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ id: "machine-1", region: "ams", state: "started" }]);
  mocks.createMachine.mockResolvedValue({ id: "machine-1", region: "ams", state: "started" });
});

describe("Fly Hub machine creation", () => {
  it("creates a separate SSH machine with the requested name, size, region, and sleep policy", async () => {
    const result = await createManagedMachine(input);
    const app = managedMachineAppName("Alice", "Demo", "personal");
    expect(result).toEqual({ app, machineId: "machine-1", region: "ams", state: "started" });
    expect(mocks.createApp).toHaveBeenCalledWith(app, cfg);
    expect(mocks.createMachine).toHaveBeenCalledWith(expect.objectContaining({
      appName: app,
      image: process.env.FLY_HUB_MACHINE_IMAGE ?? "ghcr.io/aharonyaircohen/flyhub-browser:latest",
      name: "my-machine-f972134a",
      region: "ams",
      cpuKind: "performance",
      cpus: 2,
      memoryMb: 4096,
      sshOnly: true,
      sshUsername: process.env.FLY_HUB_MACHINE_SSH_USER ?? "browser",
      startupCommand: ["/bin/sh", "-c", "sh /etc/kody-ssh/start.sh && exec sleep 2147483647"],
      sleepWhenIdle: true,
      env: { FLY_HUB_NAME: "My Machine", FLY_HUB_REQUEST_ID: input.requestId },
    }), cfg);
    expect(mocks.wait).toHaveBeenCalledWith(app, "machine-1", cfg);
  });

  it("returns an existing machine when the same request is retried", async () => {
    mocks.listMachines.mockReset();
    mocks.listMachines.mockResolvedValue([{
      id: "original", region: "fra", state: "started",
      config: { env: { FLY_HUB_REQUEST_ID: input.requestId } },
    }]);
    expect(await createManagedMachine(input)).toMatchObject({ machineId: "original" });
    expect(mocks.createMachine).not.toHaveBeenCalled();
  });

  it("waits for a machine created by a previous timed-out request", async () => {
    mocks.listMachines.mockReset();
    mocks.listMachines.mockResolvedValue([{
      id: "original", region: "fra", state: "starting",
      config: { env: { FLY_HUB_REQUEST_ID: input.requestId } },
    }]);
    expect(await createManagedMachine(input)).toMatchObject({ machineId: "original", state: "started" });
    expect(mocks.wait).toHaveBeenCalledWith(managedMachineAppName("Alice", "Demo", "personal"), "original", cfg);
    expect(mocks.createMachine).not.toHaveBeenCalled();
  });

  it("does not report a crashed retry as a successful create", async () => {
    mocks.listMachines.mockReset().mockResolvedValue([{
      id: "original", region: "fra", state: "stopped",
      config: { env: { FLY_HUB_REQUEST_ID: input.requestId } },
    }]);
    await expect(createManagedMachine(input)).rejects.toThrow(/stopped during startup/);
    expect(mocks.createMachine).not.toHaveBeenCalled();
  });

  it("reports a failed boot instead of claiming a stopped machine is ready", async () => {
    mocks.listMachines
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "machine-1", region: "ams", state: "stopped" }]);
    await expect(createManagedMachine(input)).rejects.toThrow(/stopped during startup/);
  });

  it("requires the credential vault before creating anything", async () => {
    mocks.vault.mockReturnValue(false);
    await expect(createManagedMachine(input)).rejects.toThrow(/vault/);
    expect(mocks.createApp).not.toHaveBeenCalled();
  });

  it("keeps Fly Hub machines scoped to their repository", () => {
    const app = managedMachineAppName("Alice", "Demo", "personal");
    const other = managedMachineAppName("Alice", "Other", "personal");
    expect(app).not.toBe(other);
    const filtered = visibleManagedInventory({
      total: 3, running: 3,
      machines: [
        { app, machineId: "a", state: "started", feature: "other", label: "A", region: "fra", sizeLabel: "2 GB" },
        { app: other, machineId: "b", state: "started", feature: "other", label: "B", region: "fra", sizeLabel: "2 GB" },
        { app: "kody-runner", machineId: "c", state: "started", feature: "runner", label: "C", region: "fra", sizeLabel: "2 GB" },
      ],
    }, app);
    expect(filtered.machines.map((machine) => machine.machineId)).toEqual(["a", "c"]);
  });
});
