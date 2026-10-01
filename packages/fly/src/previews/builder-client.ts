/**
 * @fileType library
 * @domain previews
 * @pattern fly-machine-spawn
 * @ai-summary Single fast Fly API call that spawns the per-PR builder
 *   machine and returns its ID + expected URL. The builder does every
 *   subsequent step (clone, build, image push, app create, IP alloc,
 *   preview machine boot) on its own and exits — the dashboard never
 *   polls it. Trap: the returned URL is NOT reachable yet; it is the
 *   deterministic destination the builder will boot once it finishes
 *   (~2-5 min), not a live link. Status callers must re-query Fly.
 *
 * Spawns the per-PR builder Fly Machine and returns immediately.
 *
 * The builder machine handles the ENTIRE preview lifecycle on its
 * own — clone, build, push image, create per-PR app, allocate IPs,
 * boot preview machine, exit. The dashboard never polls it.
 *
 * Result: a single fast Vercel→Fly call (~1s) per webhook fire. No
 * long-running serverless function, no cross-cloud TLS in the hot
 * path. The dashboard checks Fly state on demand via the existing
 * status endpoint (deterministic app name → query Fly Machines API).
 */

import { createHash } from "node:crypto";

import { logger } from "@kody-ade/base/logger";
import { derivePreviewKey } from "../preview-token";
import { clearAppBuilderCredentials } from "../../builder/src/app-builder-cleanup";

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const BUILDER_IMAGE =
  process.env.KODY_PREVIEW_BUILDER_IMAGE ??
  "registry.fly.io/kody-preview-builder:latest";
const BUILDER_HOST_APP =
  process.env.KODY_PREVIEW_BUILDER_HOST_APP ?? "kody-preview-builder";

const SPAWN_TIMEOUT_MS = 30_000;
const BUILDER_MAINTENANCE_TIMEOUT_MS = 10_000;
const BUILDER_STALE_MS = 2 * 60 * 60 * 1000;
const BUILDER_START_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_BUILDER_CPUS = 4;
const DEFAULT_BUILDER_MEMORY_MB = 4096;

interface BuilderMachineInfo {
  id?: string;
  state?: string;
  created_at?: string;
  config?: {
    env?: Record<string, string>;
    metadata?: Record<string, string>;
  };
}

export interface SpawnBuilderInput {
  repo: string;
  /** PR number for per-PR builds. Omit for base-image rebuilds. */
  pr?: number;
  /** Branch name for manual branch previews. Omit for PR/base-image builds. */
  branch?: string;
  ref: string;
  /** Per-PR Fly app name (same naming the builder will recreate inside).
   *  For base-image rebuilds, pass the `-base` app name from
   *  `basePreviewAppName(repo)`; the builder detects the suffix. */
  appName: string;
  imageTag?: string;
  flyToken: string;
  flyOrgSlug: string;
  flyRegion: string;
  githubToken?: string;
  /** Build-time secrets baked into the image as .env.production.local. */
  buildEnv?: Record<string, string>;
  /** "dev" or "prod" — picks bundled Dockerfile.preview variant. */
  buildMode?: "dev" | "prod";
  /** Per-PR preview machine sizing + lifecycle knobs, resolved from the
   * repo's kody.config.json (`fly.previews`). Passed to the builder as env so
   * the machine it boots uses these instead of the builder's hardcoded
   * fallback. Omit any field to let the builder apply its own default. */
  previewVmCpus?: number;
  previewVmMemoryMb?: number;
  previewIdleSuspend?: boolean;
  previewHealthCheck?: boolean;
  /** Temporary machine that runs clone + flyctl orchestration. */
  builderCpus?: number;
  builderMemoryMb?: number;
}

export interface SpawnBuilderResult {
  machineId: string;
  /** Deterministic public URL — the builder will boot a machine here once
   *  it finishes. Not yet reachable when this function returns. */
  expectedUrl: string;
}

export interface SpawnAppBuilderInput {
  repo: string;
  ref: string;
  appName: string;
  imageTag: string;
  buildPlan: {
    kind: string;
    rootDirectory: string;
    buildCommand?: string;
    startCommand?: string;
    port?: number;
    apiPort?: number;
    imageRef?: string;
    dockerfilePath?: string;
    dockerBuildTarget?: string;
    runtimeEnv?: Record<string, string>;
    generatedSecretNames?: string[];
    storagePath?: string;
    customDockerfile?: string;
    verification?: { path: string; expectedStatus: number };
  };
  exposure: "private" | "public";
  alwaysOn?: boolean;
  tokenHashes: string[];
  flyHubPasswordHash?: string;
  flyHubPasswordEncrypted?: string;
  flyHubName?: string;
  flyHubAppPasswordEnv?: string;
  flyHubAppPasswordEncrypted?: string;
  builderHostApp?: string;
  builderImage?: string;
  runtimeSecrets: Record<string, string>;
  runtimeEnv: Record<string, string>;
  flyToken: string;
  flyOrgSlug: string;
  flyRegion: string;
  githubToken?: string;
  gatewayImage?: string;
  storage?: Array<{ volumeId: string; mountPath: string }>;
  callback?: {
    url: string;
    token: string;
    tenantId: string;
    appId: string;
    deploymentId: string;
    requestId: string;
  };
  launch?: { repository: string; appId: string; verifyKey: string };
  builderCpus?: number;
  builderMemoryMb?: number;
}

export interface PreviewBuilderStatus {
  state: "building" | "completed" | "failed";
  error?: string;
  machineId?: string;
  machineState?: string;
  createdAt?: string;
  cleanup?: { status: string; detail: string };
}

export async function listFailedAppSetups(
  token: string,
  orgSlug: string,
  hostApp = BUILDER_HOST_APP,
) {
  const response = await fetch(builderMachinesUrl(undefined, hostApp), {
    headers: builderAuthHeaders(token),
    signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Could not read setup history: HTTP ${response.status}`);
  const seen = new Set<string>();
  return ((await response.json()) as BuilderMachineInfo[])
    .sort(newestFirst)
    .flatMap((machine) => {
      const meta = machine.config?.metadata ?? {};
      const appName = builderTargetApp(machine);
      if (
        !appName ||
        !/^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/.test(appName) ||
        meta.flyhub_build_org !== orgSlug ||
        seen.has(appName)
      )
        return [];
      seen.add(appName);
      if (meta.flyhub_build_status !== "failed") return [];
      return [
        {
          appName,
          name: meta.flyhub_build_name || appName,
          repository: meta.flyhub_build_repo || "",
          commitSha: meta.flyhub_build_ref || "",
          jobId: machine.id,
          error:
            meta.flyhub_last_error ||
            "Setup failed. Open the job to inspect its machine events.",
          cleanup: {
            status: meta.flyhub_cleanup_status || "needs_attention",
            detail:
              meta.flyhub_cleanup_detail ||
              "Cleanup has not been confirmed. Check for remaining resources.",
          },
        },
      ];
    });
}

function defaultTagFor(repo: string, ref: string): string {
  return createHash("sha256")
    .update(`${repo}@${ref}`)
    .digest("hex")
    .slice(0, 12);
}

function builderAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function builderMachinesUrl(
  machineId?: string,
  hostApp = BUILDER_HOST_APP,
): string {
  const base = `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(hostApp)}/machines`;
  return machineId
    ? `${base}/${encodeURIComponent(machineId)}?force=true`
    : base;
}

function isDestroyableBuilderState(state?: string): boolean {
  return state !== "destroyed" && state !== "destroying";
}

function isStaleBuilder(machine: BuilderMachineInfo, now: number): boolean {
  const age = builderAgeMs(machine, now);
  return age !== null && age > BUILDER_STALE_MS;
}

function builderTargetApp(machine: BuilderMachineInfo): string | undefined {
  const value =
    machine.config?.env?.APP_NAME || machine.config?.metadata?.flyhub_build_app;
  return value && value.trim() ? value : undefined;
}

function builderTargetRef(machine: BuilderMachineInfo): string | undefined {
  const value =
    machine.config?.env?.REF || machine.config?.metadata?.flyhub_build_ref;
  return value && value.trim() ? value : undefined;
}

function builderAgeMs(machine: BuilderMachineInfo, now: number): number | null {
  if (!machine.created_at) return null;
  const created = Date.parse(machine.created_at);
  return Number.isFinite(created) ? now - created : null;
}

function shouldDestroyBuilder(
  machine: BuilderMachineInfo,
  targetAppName: string,
  targetRef: string,
  now: number,
): boolean {
  if (!machine.id || !isDestroyableBuilderState(machine.state)) return false;
  // This host also runs save/restore workers. Missing APP_NAME is not evidence
  // that a machine is safe to delete; only prune identified deployment builders.
  if (
    !builderTargetApp(machine) ||
    machine.config?.env?.APP_IMAGE_JOB ||
    machine.config?.metadata?.flyhub_image_action
  )
    return false;
  if (machine.config?.metadata?.flyhub_cleanup_status === "needs_attention")
    return false;
  const samePreview = builderTargetApp(machine) === targetAppName;
  return samePreview
    ? !isReusableBuilder(machine, now, targetRef)
    : isStaleBuilder(machine, now);
}

function isRunnableBuilderState(state?: string): boolean {
  return state === "started" || state === "starting";
}

function isFreshCreatedBuilder(
  machine: BuilderMachineInfo,
  now: number,
): boolean {
  if (machine.state !== "created") return false;
  const age = builderAgeMs(machine, now);
  return age !== null && age <= BUILDER_START_GRACE_MS;
}

function isReusableBuilder(
  machine: BuilderMachineInfo,
  now: number,
  targetRef?: string,
): boolean {
  if (
    ["completed", "failed"].includes(
      machine.config?.metadata?.flyhub_build_status ?? "",
    )
  )
    return false;
  if (targetRef && builderTargetRef(machine) !== targetRef) return false;
  return (
    Boolean(machine.id) &&
    (isRunnableBuilderState(machine.state) ||
      isFreshCreatedBuilder(machine, now))
  );
}

function reusableFirst(): (
  a: BuilderMachineInfo,
  b: BuilderMachineInfo,
) => number {
  return (a, b) => {
    const aRank = isRunnableBuilderState(a.state) ? 0 : 1;
    const bRank = isRunnableBuilderState(b.state) ? 0 : 1;
    return aRank - bRank || newestFirst(a, b);
  };
}

function newestFirst(a: BuilderMachineInfo, b: BuilderMachineInfo): number {
  const aTime = a.created_at ? Date.parse(a.created_at) : 0;
  const bTime = b.created_at ? Date.parse(b.created_at) : 0;
  return bTime - aTime;
}

export async function getPreviewBuilderStatus(
  appName: string,
  token: string,
  hostApp = BUILDER_HOST_APP,
): Promise<PreviewBuilderStatus | null> {
  try {
    const res = await fetch(builderMachinesUrl(undefined, hostApp), {
      method: "GET",
      headers: builderAuthHeaders(token),
      signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const machines = ((await res.json()) as BuilderMachineInfo[])
      .filter((m) => builderTargetApp(m) === appName)
      .sort(newestFirst);
    const latest = machines[0];
    if (!latest) return null;
    const now = Date.now();
    let state: PreviewBuilderStatus["state"] = isReusableBuilder(latest, now)
      ? "building"
      : "failed";
    const savedStatus = latest.config?.metadata?.flyhub_build_status;
    if (savedStatus === "completed" || savedStatus === "failed")
      state = savedStatus;
    let exitCode: number | undefined;
    if (state !== "building" && latest.id && !savedStatus) {
      const machine = await fetch(builderMachinesUrl(latest.id, hostApp), {
        headers: builderAuthHeaders(token),
        signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
      }).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as {
                events?: Array<{
                  type?: string;
                  request?: { exit_event?: { exit_code?: number } };
                }>;
              })
            : null,
        () => null,
      );
      exitCode = machine?.events?.find((event) => event.type === "exit")
        ?.request?.exit_event?.exit_code;
      if (exitCode === 0) state = "completed";
    }
    let error: string | undefined;
    let cleanup: PreviewBuilderStatus["cleanup"];
    if (state === "failed" && latest.id) {
      const detail = await fetch(
        `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(hostApp)}/machines/${encodeURIComponent(latest.id)}/metadata`,
        {
          headers: builderAuthHeaders(token),
          signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
        },
      ).then(
        async (response) =>
          response.ok
            ? ((await response.json()) as Record<string, unknown>)
            : null,
        () => null,
      );
      if (typeof detail?.flyhub_last_error === "string")
        error = detail.flyhub_last_error.slice(-8_000);
      else if (typeof exitCode === "number")
        error = `Fly builder process exited with code ${exitCode}.`;
      if (typeof detail?.flyhub_cleanup_status === "string")
        cleanup = {
          status: detail.flyhub_cleanup_status,
          detail:
            typeof detail.flyhub_cleanup_detail === "string"
              ? detail.flyhub_cleanup_detail
              : "Cleanup has not been confirmed.",
        };
    }

    // Also scrub legacy workers and workers killed before their finally block.
    if (
      state !== "building" &&
      latest.id &&
      ["stopped", "failed"].includes(latest.state ?? "") &&
      Object.keys(latest.config?.env ?? {}).length &&
      (latest.config?.env?.KODY_BUILDER_KIND === "app" ||
        latest.config?.env?.APP_BUILD_PLAN_JSON)
    ) {
      await clearAppBuilderCredentials({
        app: hostApp,
        machine: latest.id,
        token,
        status: state,
      }).catch((err) =>
        logger.warn(
          { err, machineId: latest.id },
          "app builder credential cleanup failed",
        ),
      );
    }
    return {
      state,
      cleanup,
      error,
      machineId: latest.id,
      machineState: latest.state,
      createdAt: latest.created_at,
    };
  } catch (err) {
    logger.warn({ err, appName }, "previews.builder: status lookup failed");
    return null;
  }
}

async function destroyBuilderMachine(
  machineId: string,
  token: string,
  hostApp = BUILDER_HOST_APP,
): Promise<void> {
  const res = await fetch(builderMachinesUrl(machineId, hostApp), {
    method: "DELETE",
    headers: builderAuthHeaders(token),
    signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `destroy builder ${machineId} failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
}

async function pruneBuilderMachines(
  token: string,
  targetAppName: string,
  targetRef: string,
  hostApp = BUILDER_HOST_APP,
): Promise<BuilderMachineInfo | null> {
  try {
    const res = await fetch(builderMachinesUrl(undefined, hostApp), {
      method: "GET",
      headers: builderAuthHeaders(token),
      signal: AbortSignal.timeout(BUILDER_MAINTENANCE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const machines = (await res.json()) as BuilderMachineInfo[];
    const now = Date.now();
    const reusable =
      machines
        .filter(
          (m) =>
            m.id &&
            builderTargetApp(m) === targetAppName &&
            isReusableBuilder(m, now, targetRef),
        )
        .sort(reusableFirst())[0] ?? null;
    const doomed = machines.filter((m) => {
      if (reusable?.id === m.id) return false;
      return shouldDestroyBuilder(m, targetAppName, targetRef, now);
    });
    await Promise.all(
      doomed.map((m) =>
        destroyBuilderMachine(m.id!, token, hostApp).catch((err) =>
          logger.warn(
            { err, machineId: m.id, targetAppName },
            "previews.builder: stale builder destroy failed",
          ),
        ),
      ),
    );
    return reusable;
  } catch (err) {
    logger.warn(
      { err, targetAppName },
      "previews.builder: stale builder scan failed",
    );
    return null;
  }
}

export async function spawnPreviewBuilder(
  input: SpawnBuilderInput,
): Promise<SpawnBuilderResult> {
  const tag = input.imageTag ?? defaultTagFor(input.repo, input.ref);
  const expectedUrl = `https://${input.appName}.fly.dev`;
  const existing = await pruneBuilderMachines(
    input.flyToken,
    input.appName,
    input.ref,
  );
  if (existing?.id) {
    logger.info(
      {
        repo: input.repo,
        pr: input.pr,
        ref: input.ref,
        machineId: existing.id,
      },
      "previews.builder: active builder already running; reusing",
    );
    return {
      machineId: existing.id,
      expectedUrl,
    };
  }

  const body = {
    config: {
      image: BUILDER_IMAGE,
      env: {
        REPO: input.repo,
        REF: input.ref,
        APP_NAME: input.appName,
        IMAGE_TAG: tag,
        FLY_API_TOKEN: input.flyToken,
        FLY_ORG_SLUG: input.flyOrgSlug,
        FLY_REGION: input.flyRegion,
        // Derived preview-verify key — HKDF of KODY_MASTER_KEY with info
        // "kody-preview:v1". The raw master key never leaves the dashboard.
        // The builder threads this to the preview machine as a runtime env,
        // where the doorman reads it to verify access tickets.
        KODY_PREVIEW_VERIFY_KEY: derivePreviewKey().toString("hex"),
        // Machine identity — repo and pr are passed so the doorman can bind
        // tickets to this specific machine and reject tickets meant for a
        // different repo/pr/branch even if they present a valid HMAC.
        KODY_REPO_CONTEXT: input.repo,
        ...("pr" in input ? { KODY_PR: String(input.pr) } : {}),
        ...("branch" in input ? { KODY_BRANCH: input.branch } : {}),
        ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
        // When set, the builder posts (or updates) one idempotent
        // comment on the PR with the preview URL. Omitted on base
        // rebuilds — there's no PR to comment on.
        ...(typeof input.pr === "number"
          ? { PR_NUMBER: String(input.pr) }
          : {}),
        // When set, the builder probes GHCR for a per-repo base image
        // (kp-<hash>-base:latest) and inherits from it via Docker FROM.
        // Drops a typical PR build from ~13 min cold to ~3 min.
        ...(process.env.KODY_PREVIEW_GHCR_OWNER
          ? { MIRROR_TO_GHCR_OWNER: process.env.KODY_PREVIEW_GHCR_OWNER }
          : {}),
        ...(input.buildMode ? { PREVIEW_BUILD_MODE: input.buildMode } : {}),
        // Preview machine knobs (from kody.config.json fly.previews). The
        // builder reads these to size + configure the machine it boots,
        // instead of its own hardcoded fallback.
        ...(typeof input.previewVmCpus === "number"
          ? { PREVIEW_VM_CPUS: String(input.previewVmCpus) }
          : {}),
        ...(typeof input.previewVmMemoryMb === "number"
          ? { PREVIEW_VM_MEMORY_MB: String(input.previewVmMemoryMb) }
          : {}),
        ...(typeof input.previewIdleSuspend === "boolean"
          ? { PREVIEW_IDLE_SUSPEND: input.previewIdleSuspend ? "1" : "0" }
          : {}),
        ...(typeof input.previewHealthCheck === "boolean"
          ? { PREVIEW_HEALTHCHECK: input.previewHealthCheck ? "1" : "0" }
          : {}),
        // Build env passed as a single JSON blob so name collisions
        // with builder control vars are impossible.
        ...(input.buildEnv && Object.keys(input.buildEnv).length > 0
          ? { BUILD_ENV_JSON: JSON.stringify(input.buildEnv) }
          : {}),
      },
      auto_destroy: true,
      restart: { policy: "no" },
      // This machine orchestrates clone/install/flyctl work. Docker still
      // runs on Fly's remote builder, but large repos need more room here.
      guest: {
        cpu_kind: "shared",
        cpus: input.builderCpus ?? DEFAULT_BUILDER_CPUS,
        memory_mb: input.builderMemoryMb ?? DEFAULT_BUILDER_MEMORY_MB,
      },
    },
    region: input.flyRegion,
  };

  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(BUILDER_HOST_APP)}/machines`,
    {
      method: "POST",
      headers: builderAuthHeaders(input.flyToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `builder machine spawn failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
    );
  }
  const created = (await res.json()) as { id: string };

  logger.info(
    { repo: input.repo, pr: input.pr, ref: input.ref, machineId: created.id },
    "previews.builder: machine spawned (fire-and-forget)",
  );

  return {
    machineId: created.id,
    expectedUrl,
  };
}

export async function spawnAppBuilder(
  input: SpawnAppBuilderInput,
): Promise<SpawnBuilderResult> {
  const existing = await pruneBuilderMachines(
    input.flyToken,
    input.appName,
    input.ref,
    input.builderHostApp,
  );
  if (existing?.id)
    return {
      machineId: existing.id,
      expectedUrl: `https://${input.appName}.fly.dev`,
    };
  const body = {
    config: {
      image: input.builderImage ?? BUILDER_IMAGE,
      metadata: {
        flyhub_build_kind: "app",
        flyhub_build_app: input.appName,
        flyhub_build_ref: input.ref,
        flyhub_build_org: input.flyOrgSlug,
        flyhub_build_repo: input.repo,
        flyhub_build_name: input.flyHubName ?? input.appName,
      },
      env: {
        KODY_BUILDER_KIND: "app",
        APP_ALWAYS_ON: input.alwaysOn ? "1" : "0",
        REPO: input.repo,
        REF: input.ref,
        APP_NAME: input.appName,
        IMAGE_TAG: input.imageTag,
        APP_BUILD_PLAN_JSON: JSON.stringify(input.buildPlan),
        APP_RUNTIME_SECRETS_JSON: JSON.stringify(input.runtimeSecrets),
        APP_RUNTIME_ENV_JSON: JSON.stringify(input.runtimeEnv),
        KODY_APP_EXPOSURE: input.exposure,
        KODY_APP_TOKEN_HASHES: input.tokenHashes.join(","),
        ...(input.flyHubPasswordHash
          ? {
              FLY_HUB_PASSWORD_HASH: input.flyHubPasswordHash,
              ...(input.flyHubPasswordEncrypted
                ? { FLY_HUB_PASSWORD_ENCRYPTED: input.flyHubPasswordEncrypted }
                : {}),
              FLY_HUB_NAME: input.flyHubName ?? input.appName,
              ...(input.flyHubAppPasswordEnv
                ? { FLY_HUB_APP_PASSWORD_ENV: input.flyHubAppPasswordEnv }
                : {}),
              ...(input.flyHubAppPasswordEncrypted
                ? {
                    FLY_HUB_APP_PASSWORD_ENCRYPTED:
                      input.flyHubAppPasswordEncrypted,
                  }
                : {}),
            }
          : {}),
        FLY_API_TOKEN: input.flyToken,
        FLY_ORG_SLUG: input.flyOrgSlug,
        FLY_REGION: input.flyRegion,
        ...(input.githubToken ? { GITHUB_TOKEN: input.githubToken } : {}),
        ...(input.gatewayImage
          ? { KODY_APP_GATEWAY_IMAGE: input.gatewayImage }
          : {}),
        ...(input.storage?.length
          ? { APP_STORAGE_JSON: JSON.stringify(input.storage) }
          : {}),
        ...(input.callback
          ? { APP_CALLBACK_JSON: JSON.stringify(input.callback) }
          : {}),
        ...(input.launch
          ? {
              KODY_APP_REPOSITORY: input.launch.repository,
              KODY_APP_ID: input.launch.appId,
              KODY_APP_LAUNCH_VERIFY_KEY: input.launch.verifyKey,
            }
          : {}),
      },
      auto_destroy: false,
      restart: { policy: "no" },
      guest: {
        cpu_kind: "shared",
        cpus: input.builderCpus ?? DEFAULT_BUILDER_CPUS,
        memory_mb: input.builderMemoryMb ?? DEFAULT_BUILDER_MEMORY_MB,
      },
    },
    region: input.flyRegion,
  };
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(input.builderHostApp ?? BUILDER_HOST_APP)}/machines`,
    {
      method: "POST",
      headers: builderAuthHeaders(input.flyToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SPAWN_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const responseBody = (await res.text()).slice(0, 300);
    const envValueLengths = Object.fromEntries(
      Object.entries(body.config.env).map(([name, value]) => [
        name,
        String(value).length,
      ]),
    );
    throw new Error(
      `app builder spawn failed: ${res.status} ${responseBody}; token fingerprint=${createHash("sha256").update(input.flyToken).digest("hex").slice(0, 12)}; request bytes=${JSON.stringify(body).length}; env value lengths=${JSON.stringify(envValueLengths)}`,
    );
  }
  const created = (await res.json()) as { id: string };
  return {
    machineId: created.id,
    expectedUrl: `https://${input.appName}.fly.dev`,
  };
}
