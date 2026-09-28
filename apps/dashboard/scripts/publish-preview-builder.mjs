#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BUILDER_APP =
  process.env.KODY_PREVIEW_BUILDER_HOST_APP ?? "kody-preview-builder";

const FLY_MACHINES_BASE =
  process.env.FLY_MACHINES_API_BASE ?? "https://api.machines.dev/v1";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const builderRoot = join(
  repoRoot,
  "node_modules",
  "@kody-ade",
  "fly",
  "builder",
);

export function builderMachineTargetApp(machine) {
  const value = machine?.config?.env?.APP_NAME;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function isBuilderHostMachine(machine) {
  return Boolean(machine?.id) && !builderMachineTargetApp(machine);
}

export function builderHostMachineIds(machines) {
  return Array.isArray(machines)
    ? machines.filter(isBuilderHostMachine).map((machine) => machine.id)
    : [];
}

export function redactBuilderPublishOutput(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._:-]+/g, "Bearer [redacted]")
    .replace(/(FLY_(?:API|ACCESS)_TOKEN=)[^\s]+/g, "$1[redacted]");
}

function flyAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function flyFetch(path, token, init = {}) {
  const res = await fetch(`${FLY_MACHINES_BASE}${path}`, {
    ...init,
    headers: {
      ...flyAuthHeaders(token),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fly API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function listBuilderMachines(token, app = BUILDER_APP) {
  const res = await flyFetch(
    `/apps/${encodeURIComponent(app)}/machines`,
    token,
  );
  if (res.status === 404) return [];
  return (await res.json()) ?? [];
}

async function destroyBuilderMachine(id, token, app = BUILDER_APP) {
  await flyFetch(
    `/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(id)}?force=true`,
    token,
    { method: "DELETE" },
  );
}

export async function cleanupBuilderHostMachines({
  token,
  app = BUILDER_APP,
} = {}) {
  if (!token) throw new Error("FLY_API_TOKEN or FLY_ACCESS_TOKEN is required");
  const machines = await listBuilderMachines(token, app);
  const hostMachineIds = builderHostMachineIds(machines);
  await Promise.all(
    hostMachineIds.map((id) => destroyBuilderMachine(id, token, app)),
  );
  return hostMachineIds;
}

function publishBuilderImage(token) {
  const flyctl = process.env.FLYCTL_BIN ?? "flyctl";
  const deploy = builderPublishDeploySpec();
  return spawnSync(flyctl, deploy.args, {
    cwd: deploy.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FLY_API_TOKEN: token,
      FLY_ACCESS_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function builderPublishDeploySpec(app = BUILDER_APP) {
  return {
    cwd: builderRoot,
    args: [
      "deploy",
      "-c",
      "fly.toml",
      "--app",
      app,
      "--build-only",
      "--push",
      "--image-label",
      "latest",
      "--yes",
    ],
  };
}

async function runCli() {
  const token = process.env.FLY_API_TOKEN ?? process.env.FLY_ACCESS_TOKEN;
  if (!token) throw new Error("FLY_API_TOKEN or FLY_ACCESS_TOKEN is required");

  const result = publishBuilderImage(token);
  const stdout = redactBuilderPublishOutput(result.stdout, token);
  const stderr = redactBuilderPublishOutput(result.stderr, token);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`flyctl deploy failed with exit code ${result.status}`);
  }

  const destroyed = await cleanupBuilderHostMachines({ token });
  console.log(
    JSON.stringify(
      {
        app: BUILDER_APP,
        destroyedHostMachines: destroyed,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
