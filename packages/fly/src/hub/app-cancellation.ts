import { createHash } from "node:crypto";
import {
  listMachines,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { cancellationMatches } from "../../builder/src/app-cancellation-record";

const host = () =>
  process.env.FLY_HUB_BUILDER_HOST_APP?.trim() || "kody-preview-builder";
const metadata = (machine: { config?: { [key: string]: unknown } }) =>
  (machine.config?.metadata ?? {}) as Record<string, string>;

export async function isAppTaskCancelled(
  taskId: string,
  cfg: FlyPreviewConfig,
) {
  return (await listMachines(host(), cfg)).some((machine) =>
    cancellationMatches(metadata(machine), { orgSlug: cfg.orgSlug, taskId }),
  );
}

export async function requestAppCancellation(input: {
  cfg: FlyPreviewConfig;
  appName: string;
  workerId?: string;
  taskId?: string;
  startedAt?: number;
  ref?: string;
}) {
  const { cfg } = input;
  if (!/^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/.test(input.appName))
    throw new Error("Invalid app setup.");
  const machines = await listMachines(host(), cfg);
  const workers = machines.filter((machine) => {
    const meta = metadata(machine),
      env = machine.config?.env ?? {};
    if (
      (meta.flyhub_build_org || env.FLY_ORG_SLUG) !== cfg.orgSlug ||
      (meta.flyhub_build_app || env.APP_NAME) !== input.appName
    )
      return false;
    if (input.workerId) return machine.id === input.workerId;
    if (input.taskId && (meta.flyhub_build_task || env.APP_TASK_ID))
      return (meta.flyhub_build_task || env.APP_TASK_ID) === input.taskId;
    return Boolean(
      input.startedAt &&
      machine.createdAt &&
      Date.parse(machine.createdAt) >= input.startedAt &&
      (!input.ref || (meta.flyhub_build_ref || env.REF) === input.ref),
    );
  });
  if (input.workerId && !workers.length)
    throw new Error("This setup job was not found in your Fly organization.");
  const active = workers.filter(
    (machine) =>
      !["completed", "failed", "cancelled"].includes(
        metadata(machine).flyhub_build_status ?? "",
      ) && !["stopped", "destroyed", "failed"].includes(machine.state),
  );
  if (!active.length && !input.taskId)
    return {
      status: "finished",
      workers: [] as string[],
      message: "This setup already finished. The deployed app was kept.",
    };
  const targets: Array<{ workerId?: string; taskId?: string }> = active.length
    ? active.map((worker) => ({
        workerId: worker.id,
        taskId:
          input.taskId ||
          metadata(worker).flyhub_build_task ||
          worker.config?.env?.APP_TASK_ID,
      }))
    : [{ taskId: input.taskId }];
  for (const target of targets) {
    if (
      machines.some((machine) =>
        cancellationMatches(metadata(machine), {
          orgSlug: cfg.orgSlug,
          ...target,
        }),
      )
    )
      continue;
    const image = process.env.FLY_HUB_BUILDER_IMAGE?.trim();
    if (!image) throw new Error("The app builder is not configured.");
    const response = await fetch(
      `https://api.machines.dev/v1/apps/${encodeURIComponent(host())}/machines`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.token}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          name: `cancel-${createHash("sha256")
            .update(`${cfg.orgSlug}:${target.taskId || target.workerId}`)
            .digest("hex")
            .slice(0, 24)}`,
          region: cfg.defaultRegion,
          skip_launch: true,
          config: {
            image,
            init: { cmd: ["sh", "-c", "exit 0"] },
            env: {},
            auto_destroy: false,
            restart: { policy: "no" },
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
            metadata: {
              flyhub_record_kind: "cancellation",
              flyhub_cancel_org: cfg.orgSlug,
              flyhub_cancel_app: input.appName,
              flyhub_cancel_worker: target.workerId || "",
              flyhub_cancel_task: target.taskId || "",
              flyhub_cancel_expires: String(Date.now() + 48 * 60 * 60 * 1000),
            },
          },
        }),
      },
    );
    if (
      !response.ok &&
      !(
        [409, 422].includes(response.status) &&
        (await listMachines(host(), cfg)).some((machine) =>
          cancellationMatches(metadata(machine), {
            orgSlug: cfg.orgSlug,
            ...target,
          }),
        )
      )
    )
      throw new Error(
        `Could not cancel setup: Fly HTTP ${response.status}. Retry cancellation.`,
      );
  }
  return {
    status: active.length ? "cancelling" : "cancelled",
    workers: active.map((machine) => machine.id),
    message: active.length
      ? "Stopping setup, restoring the previous app if needed, and removing replacement resources."
      : "Setup cancelled. Further deployment requests from this run are blocked.",
  };
}
