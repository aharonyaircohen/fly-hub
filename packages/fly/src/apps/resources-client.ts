import type { FlyPreviewConfig } from "../plugin/previews/machines-client";

const BASE = "https://api.machines.dev/v1";
const timeout = 30_000;
async function request(
  path: string,
  cfg: FlyPreviewConfig,
  init: RequestInit = {},
) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`FLY_RESOURCE_${response.status}`);
  return response;
}

export const listCertificates = async (
  appName: string,
  cfg: FlyPreviewConfig,
) =>
  (
    await request(`/apps/${encodeURIComponent(appName)}/certificates`, cfg)
  ).json();
export const addCertificate = async (
  appName: string,
  hostname: string,
  cfg: FlyPreviewConfig,
) =>
  (
    await request(
      `/apps/${encodeURIComponent(appName)}/certificates/${encodeURIComponent(hostname)}`,
      cfg,
      { method: "POST" },
    )
  ).json();
export const removeCertificate = async (
  appName: string,
  hostname: string,
  cfg: FlyPreviewConfig,
) => {
  await request(
    `/apps/${encodeURIComponent(appName)}/certificates/${encodeURIComponent(hostname)}`,
    cfg,
    { method: "DELETE" },
  );
};

export const listVolumes = async (appName: string, cfg: FlyPreviewConfig) =>
  (await request(`/apps/${encodeURIComponent(appName)}/volumes`, cfg)).json();
export const createVolume = async (
  appName: string,
  input: {
    name: string;
    region: string;
    sizeGb: number;
    snapshotRetention?: number;
  },
  cfg: FlyPreviewConfig,
) =>
  (
    await request(`/apps/${encodeURIComponent(appName)}/volumes`, cfg, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        region: input.region,
        size_gb: input.sizeGb,
        encrypted: true,
        auto_backup_enabled: true,
        snapshot_retention: input.snapshotRetention ?? 7,
      }),
    })
  ).json();
export const snapshotVolume = async (
  appName: string,
  volumeId: string,
  cfg: FlyPreviewConfig,
) =>
  (
    await request(
      `/apps/${encodeURIComponent(appName)}/volumes/${encodeURIComponent(volumeId)}/snapshots`,
      cfg,
      { method: "POST" },
    )
  ).json();
export const deleteVolume = async (
  appName: string,
  volumeId: string,
  cfg: FlyPreviewConfig,
) => {
  await request(
    `/apps/${encodeURIComponent(appName)}/volumes/${encodeURIComponent(volumeId)}`,
    cfg,
    { method: "DELETE" },
  );
};

/** Isolated because Fly documents this HTTP logs endpoint as unsupported. */
export async function readAppLogs(
  appName: string,
  cfg: FlyPreviewConfig,
  nextToken?: string,
): Promise<unknown> {
  const url = new URL(
    `https://api.fly.io/api/v1/apps/${encodeURIComponent(appName)}/logs`,
  );
  if (nextToken) url.searchParams.set("next_token", nextToken);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`FLY_LOGS_${response.status}`);
  return response.json();
}
