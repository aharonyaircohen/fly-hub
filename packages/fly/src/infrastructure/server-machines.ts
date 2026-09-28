import { serverOperations } from "./server-operations";
export {
  FLY_FEATURE_TITLE,
  SERVER_PROVIDER_FEATURE_TITLE,
  batchSuspendRunning,
  countRunningInGroup,
  flyMachineTerminalLabel,
  flyTerminalTargetLabel,
  isFlyTerminalCapable,
  isServerProviderMachineRunning,
  serverProviderFeatureLabel,
} from "@kody-ade/base/infrastructure/server-machine-model";
export type {
  ServerProviderFeature,
  ServerProviderInventory,
  ServerProviderMachineInfo,
  ServerProviderMachineRow,
} from "@kody-ade/base/infrastructure/server-machine-model";
import type {
  ProviderCreateMachineInput,
  ProviderRuntimeConfig,
} from "./server-operations";
import type {
  ServerProviderFeature,
  ServerProviderInventory,
  ServerProviderMachineInfo,
} from "@kody-ade/base/infrastructure/server-machine-model";

export type ServerProviderConfig = ProviderRuntimeConfig;
export type CreateServerProviderMachineInput = ProviderCreateMachineInput;

export function listServerProviderMachines(
  appName: string,
  cfg: ServerProviderConfig,
) {
  return serverOperations.provider().listMachines(appName, cfg);
}

export function startServerProviderMachine(
  appName: string,
  machineId: string,
  cfg: ServerProviderConfig,
) {
  return serverOperations.provider().startMachine(appName, machineId, cfg);
}

export function serverProviderHostname(appName: string): string {
  return serverOperations.provider().hostname(appName);
}

export function createServerProviderMachine(
  input: CreateServerProviderMachineInput,
  cfg: ServerProviderConfig,
) {
  return serverOperations.provider().createMachine(input, cfg);
}

export function createApp(appName: string, cfg: ServerProviderConfig) {
  return serverOperations.provider().createApp(appName, cfg);
}

export function allocateSharedIps(appName: string, cfg: ServerProviderConfig) {
  return serverOperations.provider().allocateSharedIps(appName, cfg);
}

export function alignPreviewMachineSleep(
  appName: string,
  machineId: string,
  cfg: ServerProviderConfig,
  options: { idleSuspend: boolean; healthCheck: boolean; memoryMb: number },
) {
  return serverOperations
    .provider()
    .alignPreviewMachineSleep(appName, machineId, cfg, options);
}

export function listAppsByPrefix(prefix: string, cfg: ServerProviderConfig) {
  return serverOperations.provider().listAppsByPrefix(prefix, cfg);
}

export function destroyMachine(
  appName: string,
  machineId: string,
  cfg: ServerProviderConfig,
) {
  return serverOperations.provider().destroyMachine(appName, machineId, cfg);
}

export function suspendMachine(
  appName: string,
  machineId: string,
  cfg: ServerProviderConfig,
) {
  return serverOperations.provider().suspendMachine(appName, machineId, cfg);
}

export function sleepPreviewMachine(
  appName: string,
  machineId: string,
  cfg: ServerProviderConfig,
  input: { state: string; memoryMb?: number },
) {
  return serverOperations
    .provider()
    .sleepPreviewMachine(appName, machineId, cfg, input);
}

export function destroyApp(appName: string, cfg: ServerProviderConfig) {
  return serverOperations.provider().destroyApp(appName, cfg);
}

export function listServerProviderInventory(
  cfg: ServerProviderConfig,
  now?: number,
) {
  return serverOperations.provider().listInventory(cfg, now);
}

export function rowsForServerProviderApp(
  app: string,
  machines: ServerProviderMachineInfo[],
  now?: number,
  override?: {
    feature?: ServerProviderFeature;
    label?: string;
    orgSlug?: string;
  },
) {
  return serverOperations.provider().rowsForApp(app, machines, now, override);
}

export function emptyServerProviderInventory(): ServerProviderInventory {
  return serverOperations.provider().emptyInventory();
}

export function refreshServerProviderInventoryCounts(
  inventory: ServerProviderInventory,
): ServerProviderInventory {
  return serverOperations.provider().refreshInventoryCounts(inventory);
}
