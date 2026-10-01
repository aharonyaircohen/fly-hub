import { createHash, createHmac, randomBytes } from "node:crypto";
import { encrypt, deriveKeyCheck } from "@kody-ade/base/vault/crypto";
import {
  listMachines,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { runtimeAppName } from "../../builder/src/app-builder-names";
import {
  appNamePattern,
  savedIdPattern,
  savedImageRef,
} from "../../builder/src/app-image-format";
import {
  listSavedApps,
  registryBearer,
  registryManifest,
  assertPrivatePackage,
  deleteSavedAppVersion,
} from "../../builder/src/app-image-registry";

import { assertFlyHubAppOwned } from "./app-ownership";

export { listSavedApps };
export async function deleteSavedApp(
  cfg: FlyPreviewConfig,
  registry: RegistryConnection,
  id: string,
) {
  const imageRef = savedImageRef(registry.user, id);
  const jobs = await savedAppJobs(cfg, registry, Infinity);
  const active = jobs.find(
    (job) => job.imageRef === imageRef && job.status === "working",
  );
  if (active)
    throw new Error(
      `This saved version is being used by job ${active.jobId}. Wait for it to finish before deleting.`,
    );
  await deleteSavedAppVersion(registry.user, registry.token, id);
}
export type RegistryConnection = { user: string; token: string };
export type SavedAppJob = {
  jobId: string;
  workerApp: string;
  action: "save" | "create";
  status: "working" | "completed" | "failed";
  phase: string;
  error: string | null;
  name: string;
  sourceApp: string | null;
  appName: string | null;
  url: string | null;
  imageRef: string;
  createdAt: string;
  updatedAt: string;
};
const hostApp = () =>
  process.env.FLY_HUB_BUILDER_HOST_APP?.trim() || "kody-preview-builder";
const api = "https://api.machines.dev/v1";
function metadata(machine: { config?: Record<string, unknown> }) {
  return (machine.config?.metadata ?? {}) as Record<string, string>;
}

export async function savedAppJobs(
  cfg: FlyPreviewConfig,
  registry: RegistryConnection,
  limit = 20,
): Promise<SavedAppJob[]> {
  const machines = await listMachines(hostApp(), cfg);
  const owned = machines
    .filter((machine) => {
      const m = metadata(machine);
      return (
        m.flyhub_image_org === cfg.orgSlug &&
        m.flyhub_image_user === registry.user
      );
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, limit);
  return Promise.all(
    owned.map(async (machine) => {
      const response = await fetch(
        `${api}/apps/${hostApp()}/machines/${machine.id}/metadata`,
        {
          headers: { authorization: `Bearer ${cfg.token}` },
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error("Could not read saved app job progress.");
      const m = (await response.json()) as Record<string, string>;
      const interrupted =
        m.flyhub_image_status === "working" &&
        ["stopped", "destroyed", "failed"].includes(machine.state) &&
        Date.now() - (Date.parse(machine.createdAt || "") || 0) > 30_000;
      let interruptionError = `The worker stopped during ${m.flyhub_image_phase || "starting"} before finishing. Check the Fly worker logs for this job.`;
      if (
        interrupted &&
        m.flyhub_image_action === "create" &&
        appNamePattern.test(m.flyhub_image_app || "")
      ) {
        const leftovers: string[] = [];
        for (const app of [
          runtimeAppName(m.flyhub_image_app!),
          m.flyhub_image_app!,
        ]) {
          const cleanup = await fetch(`${api}/apps/${app}?force=true`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${cfg.token}` },
            signal: AbortSignal.timeout(15_000),
          }).catch(() => null);
          if (!cleanup?.ok && cleanup?.status !== 404) leftovers.push(app);
        }
        interruptionError += leftovers.length
          ? ` Cleanup could not remove: ${leftovers.join(", ")}. Remove these apps in Fly.`
          : " Its incomplete app was removed.";
      }
      const finishedUncleared =
        ["stopped", "failed"].includes(machine.state) &&
        ["completed", "failed"].includes(m.flyhub_image_status || "") &&
        Object.keys(machine.config?.env || {}).length > 0;
      if ((interrupted || finishedUncleared) && machine.config) {
        // A killed worker cannot clear its own credentials. Retain its failure record
        // and remove credentials when the owner next reads the job.
        await fetch(`${api}/apps/${hostApp()}/machines/${machine.id}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${cfg.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            skip_launch: true,
            config: {
              ...machine.config,
              env: {},
              init: { cmd: ["sh", "-c", "exit 0"] },
              metadata: interrupted
                ? {
                    ...m,
                    flyhub_image_status: "failed",
                    flyhub_image_error: interruptionError,
                  }
                : m,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => undefined);
      }
      return {
        jobId: machine.id,
        workerApp: hostApp(),
        action: m.flyhub_image_action as "save" | "create",
        status: interrupted
          ? "failed"
          : (m.flyhub_image_status as SavedAppJob["status"]),
        phase: m.flyhub_image_phase || "starting",
        error: interrupted ? interruptionError : m.flyhub_image_error || null,
        name: m.flyhub_image_name || "Saved app",
        sourceApp: m.flyhub_image_source || null,
        appName: m.flyhub_image_app || null,
        url: m.flyhub_image_app
          ? `https://${m.flyhub_image_app}.fly.dev`
          : null,
        imageRef: m.flyhub_image_ref!,
        createdAt: machine.createdAt ?? "",
        updatedAt: m.flyhub_image_updated || machine.createdAt || "",
      };
    }),
  );
}

export async function startSavedAppJob(
  cfg: FlyPreviewConfig,
  registry: RegistryConnection,
  input:
    | { action: "save"; app: string }
    | { action: "create"; id: string; name: string },
): Promise<SavedAppJob> {
  const builderImage = process.env.FLY_HUB_BUILDER_IMAGE?.trim();
  if (!builderImage)
    throw new Error("The FlyHub builder image is not configured.");
  if (input.action === "save") await assertFlyHubAppOwned(input.app, cfg);
  await assertPrivatePackage(registry.user, registry.token, true);
  let id: string,
    name: string,
    sourceApp = "",
    appName = "";
  if (input.action === "save") {
    if (!appNamePattern.test(input.app)) throw new Error("Invalid app.");
    const [machines, runtimeMachines] = await Promise.all([
      listMachines(input.app, cfg),
      listMachines(runtimeAppName(input.app), cfg),
    ]);
    const gateway = machines.find(
      (machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH,
    );
    if (!gateway || runtimeMachines.length !== 1)
      throw new Error(
        "App not found or it does not have one runtime and a password gateway.",
      );
    id = randomBytes(16).toString("hex");
    name = (gateway.config!.env!.FLY_HUB_NAME || input.app).slice(0, 80);
    sourceApp = input.app;
  } else {
    if (
      !savedIdPattern.test(input.id) ||
      !input.name.trim() ||
      input.name.length > 80
    )
      throw new Error("Enter a name for the new app.");
    id = input.id;
    name = input.name.trim();
    const bearer = await registryBearer(registry.user, registry.token);
    const manifest = await registryManifest(registry.user, bearer, `app-${id}`);
    if (manifest.annotations?.["app.flyhub.version"] !== "1")
      throw new Error("Saved app not found.");
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 38) || "saved";
    appName = `flyhub-app-${slug}-${randomBytes(6).toString("hex")}`;
  }
  const previous = await savedAppJobs(cfg, registry);
  if (
    previous.some(
      (job) =>
        job.status === "working" &&
        (input.action === "save"
          ? job.sourceApp === sourceApp
          : job.action === "create" &&
            job.imageRef === savedImageRef(registry.user, id)),
    )
  )
    throw new Error(
      "An operation for this app is already running. Follow its progress below.",
    );
  const rawKey = process.env.KODY_MASTER_KEY!;
  const imageKey = createHmac(
    "sha256",
    Buffer.from(deriveKeyCheck(rawKey), "hex"),
  )
    .update(`flyhub-app-v1:${registry.user.toLowerCase()}:${id}`)
    .digest("hex");
  const password = randomBytes(24).toString("base64url");
  const task = {
    action: input.action,
    id,
    user: registry.user,
    sourceApp,
    appName,
    name,
    region: cfg.defaultRegion,
    ...(input.action === "create"
      ? {
          passwordHash: createHash("sha256").update(password).digest("hex"),
          passwordEncrypted: encrypt(password),
        }
      : {}),
  };
  const response = await fetch(`${api}/apps/${hostApp()}/machines`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: `saved-app-${input.action}-${randomBytes(6).toString("hex")}`,
      region: cfg.defaultRegion,
      config: {
        image: builderImage,
        init: {
          cmd: [
            "node",
            "--experimental-strip-types",
            "src/app-image-worker.ts",
          ],
        },
        env: {
          FLY_API_TOKEN: cfg.token,
          FLY_ORG_SLUG: cfg.orgSlug,
          GHCR_TOKEN: registry.token,
          APP_IMAGE_KEY: imageKey,
          APP_IMAGE_JOB: JSON.stringify(task),
          APP_IMAGE_WORKER_IMAGE: builderImage,
        },
        metadata: {
          flyhub_image_org: cfg.orgSlug,
          flyhub_image_user: registry.user,
          flyhub_image_action: input.action,
          flyhub_image_status: "working",
          flyhub_image_phase: "starting",
          flyhub_image_name: name,
          flyhub_image_source: sourceApp,
          flyhub_image_app: appName,
          flyhub_image_ref: savedImageRef(registry.user, id),
        },
        auto_destroy: false,
        restart: { policy: "no" },
        guest: { cpu_kind: "shared", cpus: 2, memory_mb: 1024 },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Could not start saved app worker (Fly HTTP ${response.status}).`,
    );
  const created = (await response.json()) as {
    id: string;
    created_at?: string;
  };
  return {
    jobId: created.id,
    workerApp: hostApp(),
    action: input.action,
    status: "working",
    phase: "starting",
    error: null,
    name,
    sourceApp: sourceApp || null,
    appName: appName || null,
    url: appName ? `https://${appName}.fly.dev` : null,
    imageRef: savedImageRef(registry.user, id),
    createdAt: created.created_at ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
