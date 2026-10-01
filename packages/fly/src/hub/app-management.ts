import {
  listAppsByPrefix,
  listMachines,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { appNamePattern } from "../../builder/src/app-image-format";
import { runtimeAppName } from "../../builder/src/app-builder-names";

export class AppDeletionError extends Error {
  constructor(
    message: string,
    public status = 502,
    public deletedApps: string[] = [],
  ) {
    super(message);
  }
}

export async function deleteFlyHubApp(app: string, cfg: FlyPreviewConfig) {
  if (!appNamePattern.test(app))
    throw new AppDeletionError("App not found.", 404);
  const owned = await listAppsByPrefix("flyhub-app-", cfg);
  if (!owned.includes(app))
    throw new AppDeletionError("App not found in this Fly organization.", 404);
  const gateway = (await listMachines(app, cfg)).find(
    (m) => m.config?.env?.FLY_HUB_PASSWORD_HASH,
  );
  if (!gateway)
    throw new AppDeletionError("This is not a FlyHub deployed app.", 404);
  const runtime = runtimeAppName(app);
  const workers = await listMachines(
    process.env.FLY_HUB_BUILDER_HOST_APP?.trim() || "kody-preview-builder",
    cfg,
  );
  const active = workers.find((m) => {
    if (["stopped", "suspended", "destroyed", "failed"].includes(m.state))
      return false;
    const metadata = (m.config?.metadata ?? {}) as Record<string, string>;
    return (
      m.config?.env?.APP_NAME === app ||
      (metadata.flyhub_image_org === cfg.orgSlug &&
        metadata.flyhub_image_status === "working" &&
        (metadata.flyhub_image_source === app ||
          metadata.flyhub_image_app === app))
    );
  });
  if (active)
    throw new AppDeletionError(
      `This app has an active setup, save, or restore job (${active.id}). Wait for it to finish before deleting.`,
      409,
    );
  const deletedApps: string[] = [];
  let step = "";
  async function flyDelete(path: string) {
    const response = await fetch(`https://api.machines.dev/v1${path}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`Fly HTTP ${response.status}`);
  }
  try {
    // Remove the runtime first: the gateway stays listed so a partial failure can be retried.
    for (const name of [runtime, app]) {
      if (!owned.includes(name)) continue;
      step = `removing ${name}, its machines, and stored data`;
      // Fly's force app deletion removes the app and its owned resources together.
      await flyDelete(`/apps/${name}?force=true`);
      deletedApps.push(name);
      const check = await fetch(`https://api.machines.dev/v1/apps/${name}`, {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (check.status !== 404)
        throw new Error("Fly has not confirmed removal");
    }
    return { deletedApps, backupsKept: true };
  } catch (error) {
    const reason =
      error instanceof Error && /^Fly HTTP \d+$/.test(error.message)
        ? error.message
        : "Fly could not complete this step";
    throw new AppDeletionError(
      `Delete failed while ${step}: ${reason}. ${deletedApps.length ? `Already removed: ${deletedApps.join(", ")}. ` : ""}Saved backups were kept. Refresh the app list and retry deletion.`,
      502,
      deletedApps,
    );
  }
}
