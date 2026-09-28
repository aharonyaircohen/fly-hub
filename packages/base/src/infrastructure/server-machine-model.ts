/**
 * @fileType library
 * @domain infrastructure
 * @pattern server-machine-model
 * @ai-summary Client-safe machine row types and pure helpers shared by the
 *   server provider facade and UI components. Keep provider operations out of
 *   this module so client bundles never pull server-only code.
 */

export type ServerProviderFeature =
  | "preview"
  | "preview-base"
  | "app"
  | "builder"
  | "runner"
  | "brain"
  | "browser"
  | "other";

export interface ServerProviderMachineServiceConfig {
  autostop?: boolean | "suspend";
  autostart?: boolean;
  min_machines_running?: number;
  [key: string]: unknown;
}

export interface ServerProviderMachineConfig {
  image?: string;
  checks?: unknown;
  guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
  services?: ServerProviderMachineServiceConfig[];
  [key: string]: unknown;
}

export interface ServerProviderMachineInfo {
  id: string;
  privateAddress?: string;
  state: string;
  region: string;
  createdAt?: string;
  name?: string;
  guest?: { cpuKind?: string; cpus?: number; memoryMb?: number };
  config?: ServerProviderMachineConfig;
}

export interface ServerProviderMachineRow {
  feature: ServerProviderFeature;
  orgSlug?: string;
  app: string;
  machineId: string;
  privateAddress?: string;
  name?: string;
  state: string;
  region: string;
  label: string;
  sizeLabel: string;
  guest?: { cpuKind?: string; cpus?: number; memoryMb?: number };
  imageRef?: string;
  sshConfigured?: boolean;
  createdAt?: string;
  ageDays?: number;
}

export interface ServerProviderInventory {
  machines: ServerProviderMachineRow[];
  running: number;
  total: number;
}

export const SERVER_PROVIDER_FEATURE_TITLE: Record<
  ServerProviderFeature,
  string
> = {
  preview: "Previews",
  app: "Apps",
  runner: "Runners",
  brain: "Brain server",
  browser: "Browsers",
  builder: "Builders",
  "preview-base": "Preview base images",
  other: "Other",
};

export const FLY_FEATURE_TITLE = SERVER_PROVIDER_FEATURE_TITLE;

export function serverProviderFeatureLabel(
  feature: ServerProviderFeature,
): string {
  return SERVER_PROVIDER_FEATURE_TITLE[feature];
}

export function flyTerminalTargetLabel(target: {
  feature?: ServerProviderFeature;
  app: string;
  label?: string;
}): string {
  if (target.feature === "brain") return serverProviderFeatureLabel("brain");
  const label = target.label?.trim() || target.app;
  return target.feature
    ? `${serverProviderFeatureLabel(target.feature)}: ${label}`
    : label;
}

export function flyMachineTerminalLabel(
  machine: ServerProviderMachineRow,
): string {
  return flyTerminalTargetLabel(machine);
}

export function isFlyTerminalCapable(feature: ServerProviderFeature): boolean {
  return feature === "brain";
}

export function isServerProviderMachineRunning(state: string): boolean {
  return state === "started" || state === "running";
}

export function countRunningInGroup(rows: ServerProviderMachineRow[]): number {
  return rows.filter((row) => isServerProviderMachineRunning(row.state)).length;
}

export async function batchSuspendRunning(
  rows: ServerProviderMachineRow[],
  suspendOne: (row: ServerProviderMachineRow) => Promise<void>,
  concurrency = 6,
) {
  const running = rows.filter((row) =>
    isServerProviderMachineRunning(row.state),
  );
  const results: Array<{
    machineId: string;
    app: string;
    ok: boolean;
    error?: string;
  }> = [];
  let next = 0;
  async function worker() {
    while (next < running.length) {
      const row = running[next++];
      try {
        await suspendOne(row);
        results.push({ machineId: row.machineId, app: row.app, ok: true });
      } catch (err) {
        results.push({
          machineId: row.machineId,
          app: row.app,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, running.length) }, () =>
      worker(),
    ),
  );
  const okCount = results.filter((result) => result.ok).length;
  return { results, okCount, failCount: results.length - okCount };
}
