import { createHash } from "node:crypto";
import { isVaultConfigured } from "@kody-ade/base/vault/crypto";
import {
  createApp,
  createMachine,
  listMachines,
  waitForMachineStarted,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import type { ServerProviderInventory } from "@kody-ade/base/infrastructure/server-machine-model";

export type ManagedMachineSize = "low" | "medium" | "high";

const SIZE = {
  low: { cpuKind: "shared", cpus: 2, memoryMb: 2048 },
  medium: { cpuKind: "performance", cpus: 1, memoryMb: 2048 },
  high: { cpuKind: "performance", cpus: 2, memoryMb: 4096 },
} as const;
const DEFAULT_SSH_IMAGE = "ghcr.io/aharonyaircohen/flyhub-browser:latest";

export function managedMachineAppName(
  owner: string,
  repo: string,
  orgSlug: string,
): string {
  const hash = createHash("sha256")
    .update(`${orgSlug.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}`)
    .digest("hex")
    .slice(0, 20);
  return `flyhub-${hash}`;
}

export function visibleManagedInventory(
  inventory: ServerProviderInventory,
  appName: string,
): ServerProviderInventory {
  const machines = inventory.machines.filter(
    (machine) => !machine.app.startsWith("flyhub-") || machine.app === appName,
  );
  return {
    machines,
    total: machines.length,
    running: machines.filter((machine) =>
      machine.state === "started" || machine.state === "running",
    ).length,
  };
}

export async function createManagedMachine(input: {
  owner: string;
  repo: string;
  name: string;
  size: ManagedMachineSize;
  region?: string;
  sleepWhenIdle: boolean;
  requestId: string;
  cfg: FlyPreviewConfig;
}) {
  if (!isVaultConfigured()) {
    throw new Error("SSH credential vault is not configured");
  }
  const { cfg } = input;
  const app = managedMachineAppName(input.owner, input.repo, cfg.orgSlug);
  await createApp(app, cfg);

  // A retry after a network timeout returns the same machine.
  const existing = (await listMachines(app, cfg)).find(
    (machine) =>
      machine.config?.env?.FLY_HUB_REQUEST_ID === input.requestId,
  );
  if (existing) {
    if (existing.state === "stopped" || existing.state === "failed") {
      throw new Error(`Machine stopped during startup (${existing.state})`);
    }
    if (existing.state === "starting" || existing.state === "created") {
      await waitForMachineStarted(app, existing.id, cfg);
    }
    return {
      app,
      machineId: existing.id,
      region: existing.region,
      state: existing.state === "starting" || existing.state === "created"
        ? "started"
        : existing.state,
    };
  }

  const nameSlug = input.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "machine";
  const machine = await createMachine(
    {
      appName: app,
      name: `${nameSlug}-${input.requestId.replace(/-/g, "").slice(0,8)}`,
      region: input.region || cfg.defaultRegion,
      image: process.env.FLY_HUB_MACHINE_IMAGE ?? DEFAULT_SSH_IMAGE,
      env: {
        FLY_HUB_NAME: input.name,
        FLY_HUB_REQUEST_ID: input.requestId,
      },
      ...SIZE[input.size],
      sshOnly: true,
      sshUsername: process.env.FLY_HUB_MACHINE_SSH_USER ?? "browser",
      startupCommand: [
        "/bin/sh",
        "-c",
        "sh /etc/kody-ssh/start.sh && exec sleep 2147483647",
      ],
      sleepWhenIdle: input.sleepWhenIdle,
    },
    cfg,
  );
  await waitForMachineStarted(app, machine.id, cfg);
  // Fly's wait endpoint returns as soon as the VM starts, even if its main
  // process exits a second later. Confirm that boot actually held.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const booted = (await listMachines(app, cfg)).find((item) => item.id === machine.id);
  if (booted?.state !== "started") {
    throw new Error(`Machine stopped during startup (${booted?.state ?? "missing"})`);
  }
  return {
    app,
    machineId: machine.id,
    region: machine.region,
    state: "started",
  };
}
