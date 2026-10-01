import {
  listMachines,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { runtimeAppName } from "../../builder/src/app-builder-names";
import { clearAppBuilderCredentials } from "../../builder/src/app-builder-cleanup";

import { assertFlyHubAppOwned, AppOwnershipError } from "./app-ownership";

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
  let owned: string[];
  try {
    owned = await assertFlyHubAppOwned(app, cfg, { allowRuntimeOnly: true });
  } catch (error) {
    if (error instanceof AppOwnershipError)
      throw new AppDeletionError(error.message, error.status);
    throw error;
  }
  const gateway = (
    owned.includes(app) ? await listMachines(app, cfg) : []
  ).find((m) => m.config?.env?.FLY_HUB_PASSWORD_HASH);
  const runtime = runtimeAppName(app);
  const workers = await listMachines(
    process.env.FLY_HUB_BUILDER_HOST_APP?.trim() || "kody-preview-builder",
    cfg,
  );
  const failedSetup = workers.find((machine) => {
    const metadata = (machine.config?.metadata ?? {}) as Record<string, string>;
    return (
      metadata.flyhub_build_app === app &&
      metadata.flyhub_build_org === cfg.orgSlug &&
      (metadata.flyhub_build_status === "failed" || (metadata.flyhub_build_status === "cancelled" && metadata.flyhub_cleanup_status === "needs_attention"))
    );
  });
  if (!gateway && !failedSetup)
    throw new AppDeletionError(
      "This is not a FlyHub deployed app or a recorded failed setup.",
      404,
    );
  const active = workers.find((m) => {
    if (["stopped", "suspended", "destroyed", "failed"].includes(m.state))
      return false;
    const metadata = (m.config?.metadata ?? {}) as Record<string, string>;
    return (
      ((m.config?.env?.APP_NAME === app || metadata.flyhub_build_app === app) &&
        !["completed", "failed", "cancelled"].includes(
          metadata.flyhub_build_status ?? "",
        )) ||
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
    if (failedSetup) {
      await clearAppBuilderCredentials({
        app:
          process.env.FLY_HUB_BUILDER_HOST_APP?.trim() ||
          "kody-preview-builder",
        machine: failedSetup.id,
        token: cfg.token,
        status: (failedSetup.config?.metadata as Record<string, string> | undefined)?.flyhub_build_status === "cancelled" ? "cancelled" : "failed",
        metadata: {
          flyhub_cleanup_status: "completed",
          flyhub_cleanup_detail:
            "Remaining app resources removed. Saved backups were kept.",
        },
      }).catch(() => undefined);
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
