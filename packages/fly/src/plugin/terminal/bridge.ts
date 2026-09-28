/**
 * @fileType utility
 * @domain terminal
 * @pattern stateless-terminal-gateway-provisioner
 *
 * Provisions the transport-only Fly gateway. Terminal process, generation,
 * revision, and screen state are owned by the Brain terminal agent.
 */
import crypto from "node:crypto";

import { logger } from "@kody-ade/base/logger";
import { slugifyTitle } from "@kody-ade/base/slug";

import type { FlyPreviewConfig } from "../previews/machines-client";
import { allocateIpsIfMissing } from "../runners/brain";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT } from "./bridge-stateless-script";

const FLY_API_BASE = "https://api.machines.dev/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const BRIDGE_HEALTH_TIMEOUT_MS = 90_000;
const BRIDGE_HEALTH_INTERVAL_MS = 2_000;
const BRIDGE_CREATE_ATTEMPTS = 3;

export const TERMINAL_BRIDGE_BASE_IMAGE =
  process.env.KODY_TERMINAL_BRIDGE_BASE_IMAGE ?? "node:22-bookworm";

export function terminalBridgeVersionFor(input: {
  startScript: string;
  bridgeScript: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(input.startScript)
    .update("\0")
    .update(input.bridgeScript)
    .digest("hex")
    .slice(0, 16);
}

export const TERMINAL_BRIDGE_START_SCRIPT = String.raw`#!/bin/sh
set -eu

if ! command -v curl >/dev/null 2>&1 || ! command -v ssh >/dev/null 2>&1 || ! command -v ssh-agent >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl openssh-client
  rm -rf /var/lib/apt/lists/*
fi

if ! command -v flyctl >/dev/null 2>&1; then
  curl -fsSL https://fly.io/install.sh | sh -s -- v0.4.50 --non-interactive
  cp /root/.fly/bin/flyctl /usr/local/bin/flyctl
fi

mkdir -p /root/.fly
printf 'wire_guard_websockets: true\n' > /root/.fly/config.yml
exec node /app/bridge.mjs
`;

export const TERMINAL_BRIDGE_SCRIPT = TERMINAL_BRIDGE_STATELESS_SCRIPT;
export const TERMINAL_BRIDGE_VERSION = terminalBridgeVersionFor({
  startScript: TERMINAL_BRIDGE_START_SCRIPT,
  bridgeScript: TERMINAL_BRIDGE_SCRIPT,
});

interface FlyFetchOptions {
  method?: "GET" | "POST" | "DELETE";
  token: string;
  body?: unknown;
  allow404?: boolean;
}

interface FlyApp {
  name?: string;
}

interface FlyMachine {
  id: string;
  state?: string;
  config?: {
    image?: string;
    env?: Record<string, string>;
  };
}

export interface TerminalBridgeInfo {
  app: string;
  url: string;
  machineId: string;
  secret: string;
}

async function flyFetch<T>(
  path: string,
  options: FlyFetchOptions,
): Promise<T | null> {
  const response = await fetch(`${FLY_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404 && options.allow404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `Fly Machines API ${response.status} on ${path}: ${body.slice(0, 200) || response.statusText}`,
    ) as Error & { status?: number; body?: string; path?: string };
    error.status = response.status;
    error.body = body;
    error.path = path;
    throw error;
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  return raw.trim() ? (JSON.parse(raw) as T) : null;
}

export function terminalBridgeAppName(config: FlyPreviewConfig): string {
  const org = slugifyTitle(config.orgSlug, {
    maxLength: 24,
    fallback: "fly",
    allowUnderscore: false,
  });
  const hash = crypto
    .createHash("sha256")
    .update(`${config.orgSlug}:${config.token}`)
    .digest("hex")
    .slice(0, 12);
  return `kody-terminal-${org}-${hash}`;
}

function bridgeUrl(app: string): string {
  return `https://${app}.fly.dev`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridgeHealth(url: string): Promise<void> {
  const deadline = Date.now() + BRIDGE_HEALTH_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(BRIDGE_HEALTH_INTERVAL_MS);
  }
  throw new Error(`terminal bridge: health check failed (${lastError})`);
}

async function ensureApp(
  config: FlyPreviewConfig,
  app: string,
): Promise<boolean> {
  const existing = await flyFetch<FlyApp>(`/apps/${encodeURIComponent(app)}`, {
    token: config.token,
    allow404: true,
  });
  if (existing) return false;
  try {
    await flyFetch<FlyApp>("/apps", {
      method: "POST",
      token: config.token,
      body: { app_name: app, org_slug: config.orgSlug },
    });
  } catch (error) {
    if ((error as { status?: number }).status !== 422) throw error;
  }
  await allocateIpsIfMissing(config.token, app);
  return true;
}

function isLiveMachine(machine: FlyMachine): boolean {
  return machine.state !== "destroyed" && machine.state !== "destroying";
}

async function listMachines(
  config: FlyPreviewConfig,
  app: string,
): Promise<FlyMachine[]> {
  const machines = await flyFetch<FlyMachine[]>(
    `/apps/${encodeURIComponent(app)}/machines`,
    { token: config.token, allow404: true },
  );
  return machines?.filter(isLiveMachine) ?? [];
}

async function destroyMachine(
  config: FlyPreviewConfig,
  app: string,
  machineId: string,
): Promise<void> {
  await flyFetch(
    `/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machineId)}?force=true`,
    { method: "DELETE", token: config.token, allow404: true },
  );
}

function machineSecret(machine: FlyMachine): string | null {
  const secret = machine.config?.env?.BRIDGE_AUTH_SECRET;
  return typeof secret === "string" && secret.trim() ? secret : null;
}

function sameImage(a: string, b: string): boolean {
  const withoutDigest = (value: string) => value.split("@", 1)[0];
  return withoutDigest(a) === withoutDigest(b);
}

function canReuseMachine(machine: FlyMachine): boolean {
  return (
    machine.config?.env?.KODY_TERMINAL_BRIDGE_VERSION ===
      TERMINAL_BRIDGE_VERSION &&
    sameImage(machine.config?.image ?? "", TERMINAL_BRIDGE_BASE_IMAGE) &&
    machineSecret(machine) !== null
  );
}

function isMachineNameConflict(error: unknown): boolean {
  const typed = error as { status?: number; body?: string };
  return (
    typed.status === 409 &&
    typed.body?.includes("unique machine name violation") === true
  );
}

async function createBridgeMachine(
  config: FlyPreviewConfig,
  app: string,
  secret: string,
): Promise<FlyMachine> {
  const machine = await flyFetch<FlyMachine>(
    `/apps/${encodeURIComponent(app)}/machines`,
    {
      method: "POST",
      token: config.token,
      body: {
        name: `terminal-${config.defaultRegion}`,
        region: config.defaultRegion,
        config: {
          image: TERMINAL_BRIDGE_BASE_IMAGE,
          env: {
            PORT: "8080",
            BRIDGE_AUTH_SECRET: secret,
            KODY_TERMINAL_BRIDGE_VERSION: TERMINAL_BRIDGE_VERSION,
          },
          files: [
            {
              guest_path: "/app/start.sh",
              raw_value: Buffer.from(TERMINAL_BRIDGE_START_SCRIPT).toString(
                "base64",
              ),
            },
            {
              guest_path: "/app/bridge.mjs",
              raw_value: Buffer.from(TERMINAL_BRIDGE_SCRIPT).toString("base64"),
            },
          ],
          init: { exec: ["sh", "/app/start.sh"] },
          auto_destroy: false,
          restart: { policy: "on-failure", max_retries: 3 },
          guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
          services: [
            {
              ports: [
                { port: 443, handlers: ["tls", "http"] },
                { port: 80, handlers: ["http"], force_https: true },
              ],
              protocol: "tcp",
              internal_port: 8080,
              autostop: "suspend",
              autostart: true,
              min_machines_running: 0,
              concurrency: {
                type: "connections",
                soft_limit: 25,
                hard_limit: 50,
              },
            },
          ],
          checks: {
            healthz: {
              type: "http",
              port: 8080,
              method: "GET",
              path: "/healthz",
              interval: "30s",
              timeout: "5s",
              grace_period: "120s",
            },
          },
        },
      },
    },
  );
  if (!machine?.id) {
    throw new Error("terminal bridge: create machine returned empty");
  }
  return machine;
}

async function createOrConvergeMachine(input: {
  config: FlyPreviewConfig;
  app: string;
  secret: string;
}): Promise<{ machine: FlyMachine; secret: string }> {
  let lastConflict: unknown;
  for (let attempt = 1; attempt <= BRIDGE_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return {
        machine: await createBridgeMachine(
          input.config,
          input.app,
          input.secret,
        ),
        secret: input.secret,
      };
    } catch (error) {
      if (!isMachineNameConflict(error)) throw error;
      lastConflict = error;
      const conflicting = (await listMachines(input.config, input.app))[0];
      if (conflicting && canReuseMachine(conflicting)) {
        return { machine: conflicting, secret: machineSecret(conflicting)! };
      }
      if (conflicting) {
        logger.info(
          { app: input.app, machineId: conflicting.id, attempt },
          "terminal bridge: removing stale conflicting gateway",
        );
        await destroyMachine(input.config, input.app, conflicting.id);
      }
    }
  }
  throw lastConflict instanceof Error
    ? lastConflict
    : new Error("terminal bridge: machine name conflict did not converge");
}

export async function ensureTerminalBridge(
  config: FlyPreviewConfig,
): Promise<TerminalBridgeInfo> {
  if (!config.token.trim()) throw new Error("terminal bridge: fly token required");
  const app = terminalBridgeAppName(config);
  const appCreated = await ensureApp(config, app);
  const existingMachines = await listMachines(config, app);
  const existing =
    existingMachines.find(canReuseMachine) ?? existingMachines[0] ?? null;

  if (existing && canReuseMachine(existing)) {
    await Promise.all(
      existingMachines
        .filter((machine) => machine.id !== existing.id)
        .map((machine) => destroyMachine(config, app, machine.id)),
    );
    const url = bridgeUrl(app);
    try {
      await waitForBridgeHealth(url);
    } catch (error) {
      logger.warn(
        { error, app, machineId: existing.id },
        "terminal bridge: reusable gateway failed health check; ensuring IPs",
      );
      await allocateIpsIfMissing(config.token, app);
      await waitForBridgeHealth(url);
    }
    return {
      app,
      url,
      machineId: existing.id,
      secret: machineSecret(existing)!,
    };
  }

  if (existing) await destroyMachine(config, app, existing.id);
  if (!appCreated) await allocateIpsIfMissing(config.token, app);
  const created = await createOrConvergeMachine({
    config,
    app,
    secret: crypto.randomBytes(32).toString("hex"),
  });
  logger.info(
    { app, machineId: created.machine.id },
    "terminal bridge: stateless gateway provisioned",
  );
  const url = bridgeUrl(app);
  await waitForBridgeHealth(url);
  return {
    app,
    url,
    machineId: created.machine.id,
    secret: created.secret,
  };
}

export async function findTerminalBridge(
  config: FlyPreviewConfig,
): Promise<TerminalBridgeInfo | null> {
  if (!config.token.trim()) return null;
  const app = terminalBridgeAppName(config);
  const existingApp = await flyFetch<FlyApp>(
    `/apps/${encodeURIComponent(app)}`,
    { token: config.token, allow404: true },
  );
  if (!existingApp) return null;
  const existing = (await listMachines(config, app))[0];
  if (!existing || !canReuseMachine(existing)) return null;
  const url = bridgeUrl(app);
  await waitForBridgeHealth(url);
  return {
    app,
    url,
    machineId: existing.id,
    secret: machineSecret(existing)!,
  };
}
