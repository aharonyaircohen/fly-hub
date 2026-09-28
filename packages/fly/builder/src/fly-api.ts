/**
 * Minimal Fly Machines REST + GraphQL client for the builder CLI.
 *
 * Builder runs inside a Fly Machine, so all of these calls are
 * Fly→Fly TLS — no Vercel→Fly hop. Idempotent operations re-run
 * cleanly on PR sync.
 */

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const FLY_GRAPHQL = "https://api.fly.io/graphql";
const REQUEST_TIMEOUT_MS = 30_000;
const MACHINE_CREATE_TIMEOUT_MS = 180_000;
const FLY_SUSPEND_MEMORY_LIMIT_MB = 2048;

function authHeader(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function shouldRetryCreatePreviewMachine(
  status: number,
  body: string,
): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /MANIFEST_UNKNOWN|manifest unknown/i.test(body)
  );
}

async function expectOk(res: Response, ctx: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${ctx} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }
}

export async function appExists(
  appName: string,
  token: string,
): Promise<boolean> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}`,
    {
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return false;
  await expectOk(res, "appExists");
  return true;
}

export async function createApp(
  appName: string,
  orgSlug: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${FLY_MACHINES_BASE}/apps`, {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify({ app_name: appName, org_slug: orgSlug }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 422) return; // name taken — idempotent
  await expectOk(res, "createApp");
}

export async function allocateSharedIps(
  appName: string,
  token: string,
): Promise<void> {
  const mutation = `
    mutation AllocateIps($appId: ID!) {
      v4: allocateIpAddress(input: { appId: $appId, type: shared_v4 }) { ipAddress { address } }
      v6: allocateIpAddress(input: { appId: $appId, type: v6 }) { ipAddress { address } }
    }
  `;
  const res = await fetch(FLY_GRAPHQL, {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify({ query: mutation, variables: { appId: appName } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await expectOk(res, "allocateSharedIps");
  const data = (await res.json()) as { errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    const msgs = data.errors.map((e) => e.message).join("; ");
    if (!/already|exists/i.test(msgs))
      throw new Error(`allocateSharedIps: ${msgs}`);
  }
}

export async function allocatePrivateIp(
  appName: string,
  token: string,
): Promise<void> {
  const mutation = `
    mutation AllocatePrivateIp($appId: ID!) {
      allocateIpAddress(input: { appId: $appId, type: private_v6 }) { ipAddress { address } }
    }
  `;
  const res = await fetch(FLY_GRAPHQL, {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify({ query: mutation, variables: { appId: appName } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await expectOk(res, "allocatePrivateIp");
  const data = (await res.json()) as { errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    const messages = data.errors.map((error) => error.message).join("; ");
    if (!/already|exists/i.test(messages))
      throw new Error(`allocatePrivateIp: ${messages}`);
  }
}

export async function listMachines(
  appName: string,
  token: string,
): Promise<
  Array<{
    id: string;
    state: string;
    region?: string;
    config?: { image?: string; env?: Record<string, string> };
  }>
> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines`,
    {
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return [];
  await expectOk(res, "listMachines");
  const data = (await res.json()) as Array<{
    id: string;
    state: string;
    region?: string;
    config?: { image?: string; env?: Record<string, string> };
  }>;
  return data.map((m) => ({
    id: m.id,
    state: m.state,
    region: m.region,
    config: m.config,
  }));
}

export async function destroyMachine(
  appName: string,
  machineId: string,
  token: string,
): Promise<void> {
  await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/stop`,
    {
      method: "POST",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => undefined);
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
    {
      method: "DELETE",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return;
  await expectOk(res, "destroyMachine");
}

export async function destroyApp(
  appName: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}`,
    {
      method: "DELETE",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return;
  await expectOk(res, "destroyApp");
}

export interface CreatePreviewMachineInput {
  appName: string;
  region: string;
  image: string;
  internalPort?: number;
  additionalPorts?: number[];
  /** Runtime env (vault secrets) — needed for SSR pages that read
   *  DATABASE_URL, BLOB_READ_WRITE_TOKEN, etc. on each request. */
  env?: Record<string, string>;
  /** Per-repo machine knobs from kody.config.json (`fly.previews`), passed
   *  in by the dashboard via builder env. Each falls back to the historical
   *  hardcoded default when unset. */
  cpus?: number;
  memoryMb?: number;
  idleSuspend?: boolean;
  /** Re-enable a periodic HTTP health check. OFF by default — a check pings
   *  the machine forever, defeating `autostop: "suspend"`. */
  healthCheck?: boolean;
  skipServiceRegistration?: boolean;
  publicServices?: boolean;
  mounts?: Array<{ volumeId: string; path: string }>;
  processGroup?: string;
}

function autostopForPreview(
  idleSuspend: boolean,
  memoryMb: number,
): "suspend" | true | "off" {
  if (!idleSuspend) return "off";
  return memoryMb <= FLY_SUSPEND_MEMORY_LIMIT_MB ? "suspend" : true;
}

export async function createPreviewMachine(
  input: CreatePreviewMachineInput,
  token: string,
): Promise<string> {
  const internalPort = input.internalPort ?? 8080;
  // 2 GB is the default because Fly suspend is only supported/recommended at
  // <= 2 GB. Heavy dev-mode repos can opt into 4 GB, which sleeps via stop
  // mode instead of suspend.
  const cpus =
    typeof input.cpus === "number" && input.cpus > 0 ? input.cpus : 2;
  const memoryMb =
    typeof input.memoryMb === "number" && input.memoryMb > 0
      ? input.memoryMb
      : 2048;
  const idleSuspend = input.idleSuspend !== false; // default ON
  const body = {
    region: input.region,
    ...(input.skipServiceRegistration
      ? { skip_service_registration: true }
      : {}),
    config: {
      image: input.image,
      ...(input.processGroup
        ? { metadata: { fly_process_group: input.processGroup } }
        : {}),
      ...(input.mounts?.length
        ? {
            mounts: input.mounts.map((mount) => ({
              volume: mount.volumeId,
              path: mount.path,
            })),
          }
        : {}),
      env: input.env ?? {},
      auto_destroy: false,
      restart: { policy: "always" },
      guest: { cpu_kind: "shared", cpus, memory_mb: memoryMb },
      ...(input.publicServices === false
        ? {}
        : {
            services: [
              {
                ports: [
                  { port: 443, handlers: ["tls", "http"], force_https: false },
                  { port: 80, handlers: ["http"] },
                ],
                protocol: "tcp",
                internal_port: internalPort,
                // The Fly *Machines API* names these `autostop`/`autostart`.
                // The fly.toml names (`auto_stop_machines`/`auto_start_machines`)
                // are SILENTLY DROPPED here — which is why every preview ran 24/7
                // (no autostop) and won't wake once stopped (no autostart).
                autostop: autostopForPreview(idleSuspend, memoryMb),
                autostart: true,
                min_machines_running: 0,
              },
              ...(input.additionalPorts ?? []).map((port) => ({
                ports: [{ port, handlers: ["http"] }],
                protocol: "tcp",
                internal_port: port,
                autostop: autostopForPreview(idleSuspend, memoryMb),
                autostart: true,
                min_machines_running: 0,
              })),
            ],
          }),
      // By default NO machine-level `checks`: a periodic HTTP check (we had
      // GET / every 15s) issues a request to the machine forever, so Fly
      // never sees it as idle and `autostop: "suspend"` can never fire. Opt
      // back in only via kody.config.json `fly.previews.healthCheck` if a
      // repo really wants health gating (and accepts it stays awake).
      ...(input.healthCheck
        ? {
            checks: {
              httpget: {
                type: "http",
                port: internalPort,
                method: "GET",
                path: "/",
                interval: "30s",
                timeout: "10s",
                grace_period: "30s",
              },
            },
          }
        : {}),
    },
  };
  // Retry on MANIFEST_UNKNOWN — Fly's registry is eventually consistent
  // for ~5s after `flyctl deploy --push`.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(
      `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(input.appName)}/machines`,
      {
        method: "POST",
        headers: authHeader(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MACHINE_CREATE_TIMEOUT_MS),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { id: string };
      return data.id;
    }
    const text = await res.text().catch(() => "");
    lastErr = new Error(
      `createPreviewMachine ${res.status}: ${text.slice(0, 400)}`,
    );
    if (!shouldRetryCreatePreviewMachine(res.status, text)) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr ?? new Error("createPreviewMachine failed (unknown)");
}

export async function waitForMachineStarted(
  appName: string,
  machineId: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/wait?state=started&timeout=60`,
    { headers: authHeader(token), signal: AbortSignal.timeout(100_000) },
  );
  await expectOk(res, "waitForMachineStarted");
}

async function machineAction(
  appName: string,
  machineId: string,
  action: "start" | "stop" | "cordon" | "uncordon",
  token: string,
): Promise<void> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/${action}`,
    {
      method: "POST",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (action === "start" && res.status === 409) return;
  await expectOk(res, action);
}
export const startMachine = async (
  appName: string,
  machineId: string,
  token: string,
) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await machineAction(appName, machineId, "start", token);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("start failed: 412"))
        throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
  }
  throw new Error("start failed: Machine did not become startable within 60s");
};
export const stopMachine = (
  appName: string,
  machineId: string,
  token: string,
) => machineAction(appName, machineId, "stop", token);
export const cordonMachine = (
  appName: string,
  machineId: string,
  token: string,
) => machineAction(appName, machineId, "cordon", token);
export const uncordonMachine = (
  appName: string,
  machineId: string,
  token: string,
) => machineAction(appName, machineId, "uncordon", token);

export async function snapshotVolume(
  appName: string,
  volumeId: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/volumes/${encodeURIComponent(volumeId)}/snapshots`,
    {
      method: "POST",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  await expectOk(res, "snapshotVolume");
}
