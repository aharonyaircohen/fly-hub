/**
 * @fileType library
 * @domain terminal
 * @pattern terminal-inventory-authority
 *
 * Server-only helpers for choosing the Fly authority used by terminal routes.
 * General terminals use the repo Fly inventory. Brain terminals use the saved
 * Brain service when it is the requested target, because it may live under a
 * different Fly token or org than the repo default.
 */
import "server-only";

import type { NextRequest } from "next/server";

import {
  listServerProviderInventory,
  listServerProviderMachines,
  rowsForServerProviderApp,
  type ServerProviderConfig,
  type ServerProviderInventory,
  type ServerProviderMachineRow,
} from "../infrastructure/server-machines";
import {
  applySavedBrainMachineToInventory,
  emptyServerProviderInventory,
  refreshServerProviderInventoryCounts,
  resolveSavedBrainServiceForRequest,
  type SavedBrainServiceForRequest,
} from "../infrastructure/server-brain";
import type { ServerProviderContext } from "../infrastructure/server-context";

export interface TerminalInventoryRequestTarget {
  brainRequested?: boolean;
  app?: string;
  machineId?: string;
}

export interface TerminalInventoryAuthority {
  inventory: ServerProviderInventory;
  savedBrain: SavedBrainServiceForRequest | null;
}

export function terminalTargetFlyConfig(
  cfg: ServerProviderConfig,
  orgSlug: string | undefined,
): ServerProviderConfig {
  return orgSlug && orgSlug !== cfg.orgSlug ? { ...cfg, orgSlug } : cfg;
}

export function terminalFlyConfigForMachine(
  cfg: ServerProviderConfig,
  machine: ServerProviderMachineRow,
  savedBrain: SavedBrainServiceForRequest | null,
): ServerProviderConfig {
  const savedBrainMachine = savedBrain?.brain.machine;
  const usesSavedBrainToken =
    machine.feature === "brain" &&
    savedBrain &&
    (savedBrainMachine?.app === machine.app ||
      savedBrain.brain.stored?.appName === machine.app ||
      savedBrain.brain.app === machine.app);
  const baseCfg = usesSavedBrainToken
    ? {
        ...cfg,
        token: savedBrain.flyToken,
        defaultRegion: savedBrain.brain.defaultRegion,
      }
    : cfg;
  return terminalTargetFlyConfig(baseCfg, machine.orgSlug);
}

export function terminalBridgeConfigCandidates(
  targetCfg: ServerProviderConfig,
): ServerProviderConfig[] {
  return [targetCfg];
}

function savedBrainTargetsRequest(
  savedBrain: SavedBrainServiceForRequest | null,
  target: TerminalInventoryRequestTarget,
): boolean {
  if (!savedBrain?.brain.machine) return false;
  if (target.brainRequested) return true;
  const app = target.app?.trim();
  const machineId = target.machineId?.trim();
  if (!app && !machineId) return false;
  return (
    app === savedBrain.brain.app ||
    app === savedBrain.brain.stored?.appName ||
    app === savedBrain.brain.machine.app ||
    machineId === savedBrain.brain.machine.machineId
  );
}

function savedBrainInventory(
  savedBrain: SavedBrainServiceForRequest,
): ServerProviderInventory {
  const inventory = emptyServerProviderInventory();
  applySavedBrainMachineToInventory(inventory, savedBrain.brain);
  return refreshServerProviderInventoryCounts(inventory);
}

async function refreshedSavedBrainInventory(
  cfg: ServerProviderConfig,
  savedBrain: SavedBrainServiceForRequest,
): Promise<ServerProviderInventory> {
  const app = savedBrain.brain.machine?.app ?? savedBrain.brain.app;
  const targetCfg = terminalTargetFlyConfig(
    {
      ...cfg,
      token: savedBrain.flyToken,
      defaultRegion: savedBrain.brain.defaultRegion,
    },
    savedBrain.brain.orgSlug,
  );
  let machines;
  try {
    machines = await listServerProviderMachines(app, targetCfg);
  } catch {
    return savedBrainInventory(savedBrain);
  }
  const inventory = emptyServerProviderInventory();
  inventory.machines = rowsForServerProviderApp(app, machines, undefined, {
    feature: "brain",
    label: savedBrain.brain.machine?.label ?? savedBrain.brain.app,
    orgSlug: savedBrain.brain.orgSlug,
  });
  return inventory.machines.length > 0
    ? refreshServerProviderInventoryCounts(inventory)
    : savedBrainInventory(savedBrain);
}

export async function loadTerminalInventoryAuthority(
  req: NextRequest,
  cfg: ServerProviderConfig,
  target: TerminalInventoryRequestTarget,
  context?: ServerProviderContext,
): Promise<TerminalInventoryAuthority> {
  const savedBrain = await resolveSavedBrainServiceForRequest(req, context);
  if (savedBrainTargetsRequest(savedBrain, target)) {
    return {
      // Persisted Brain metadata identifies the machine but its lifecycle
      // state can already be stale after Fly auto-suspends it. Refresh the
      // target app so terminal startup can wake a sleeping machine instead of
      // returning a websocket that immediately exits.
      inventory: await refreshedSavedBrainInventory(cfg, savedBrain!),
      savedBrain,
    };
  }
  if (target.brainRequested && !target.app && !target.machineId) {
    return {
      inventory: emptyServerProviderInventory(),
      savedBrain,
    };
  }

  let inventory: ServerProviderInventory;
  try {
    inventory = await listServerProviderInventory(cfg);
  } catch (err) {
    if (savedBrainTargetsRequest(savedBrain, target)) {
      return {
        inventory: savedBrainInventory(savedBrain!),
        savedBrain,
      };
    }
    throw err;
  }

  if (savedBrain) {
    applySavedBrainMachineToInventory(inventory, savedBrain.brain);
    inventory = refreshServerProviderInventoryCounts(inventory);
  }

  return { inventory, savedBrain };
}
