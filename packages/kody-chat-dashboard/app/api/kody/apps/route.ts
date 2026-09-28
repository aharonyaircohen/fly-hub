import { NextRequest, NextResponse } from "next/server";
import { verifyRepoWriteAccess } from "@kody-ade/base/auth";
import { verifyRepoReadAccess } from "@kody-ade/base/auth";
import { readVault } from "@kody-ade/base/vault/store";
import { upsertSecret } from "@kody-ade/base/vault/mutations";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  generateAppAccessToken,
  hashAppAccessToken,
} from "@kody-ade/fly/apps/access-token";
import { deriveAppLaunchKey } from "@kody-ade/fly/apps/access-ticket";
import { generateFlyAppName } from "@kody-ade/fly/apps/source-detector";
import { spawnAppBuilder } from "@kody-ade/fly/apps/builder-client";
import { getPreviewBuilderStatus } from "@kody-ade/fly/apps/builder-client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import { listMachines } from "@kody-ade/fly/apps/machines-client";
import { listCertificates } from "@kody-ade/fly/apps/resources-client";
import { z } from "zod";
import crypto from "node:crypto";
import { inspectRepositoryApp } from "../../../../src/dashboard/lib/apps/source-inspection";
import { checkAppRateLimit } from "../../../../src/dashboard/lib/apps/rate-limit";
import { parseGitHubRepository } from "../../../../src/dashboard/lib/apps/source-repository";
import { planAppRuntimeSecrets } from "../../../../src/dashboard/lib/apps/runtime-configuration";
import {
  reconciledAppStatus,
  visibleAppStatus,
} from "../../../../src/dashboard/lib/apps/reconcile-status";

const headers = { "Cache-Control": "no-store, max-age=0" };
const json = (body: unknown, init?: ResponseInit) =>
  NextResponse.json(body, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });

export async function GET(req: NextRequest) {
  const access = await verifyRepoReadAccess(req);
  if (access instanceof NextResponse) return access;
  const tenantId = `${access.auth.owner}/${access.auth.repo}`;
  try {
    const backend = createBackendClient();
    const apps = await backend.query(backendApi.apps.list, { tenantId });
    const cfg = resolveAppHostingConfig();
    if (cfg)
      await Promise.all(
        apps
          .filter(
            (app) => app.observedStatus !== "deleted" && app.provider?.appName,
          )
          .map(async (app) => {
            try {
              const machines = await listMachines(app.provider.appName, cfg);
              const running = machines.filter(
                (machine) => machine.state === "started",
              );
              const builder = await getPreviewBuilderStatus(
                app.provider.appName,
                cfg.token,
              );
              const observedStatus = reconciledAppStatus({
                current: app.observedStatus,
                exposure: app.exposure,
                machines,
                builderState: builder?.state,
              });
              const updatedAt = new Date().toISOString();
              if (observedStatus !== app.observedStatus)
                await backend.mutation(backendApi.apps.transition, {
                  tenantId,
                  appId: app.appId,
                  observedStatus,
                  updatedAt,
                });
              if (
                app.currentDeploymentId &&
                (observedStatus === "running" || observedStatus === "failed")
              ) {
                const runtime = running.find(
                  (machine) =>
                    !(machine.config?.env as Record<string, string> | undefined)
                      ?.KODY_APP_TOKEN_HASHES,
                );
                await backend.mutation(backendApi.appDeployments.update, {
                  tenantId,
                  appId: app.appId,
                  deploymentId: app.currentDeploymentId,
                  status: observedStatus === "running" ? "running" : "failed",
                  ...(runtime ? { runtimeMachineId: runtime.id } : {}),
                  updatedAt,
                  completedAt: updatedAt,
                });
                if (app.currentAction)
                  await backend.mutation(backendApi.apps.endAction, {
                    tenantId,
                    appId: app.appId,
                    requestId: app.currentAction.requestId,
                    updatedAt,
                  });
              }
              if (app.domains.length) {
                const raw = (await listCertificates(
                  app.provider.appName,
                  cfg,
                )) as unknown;
                const certificates = Array.isArray(raw)
                  ? raw
                  : raw && typeof raw === "object" && "certificates" in raw
                    ? ((raw as { certificates?: unknown[] }).certificates ?? [])
                    : [];
                const domains = app.domains.map(
                  (domain: { hostname: string; status: string }) => {
                    const certificate = certificates.find(
                      (item) =>
                        item &&
                        typeof item === "object" &&
                        ((item as { hostname?: string }).hostname ===
                          domain.hostname ||
                          (item as { hostname?: string }).hostname ===
                            domain.hostname),
                    ) as Record<string, unknown> | undefined;
                    return certificate
                      ? {
                          ...domain,
                          status:
                            certificate.configured === true
                              ? "ready"
                              : String(
                                  certificate.client_status ??
                                    certificate.status ??
                                    "pending",
                                ),
                        }
                      : domain;
                  },
                );
                if (JSON.stringify(domains) !== JSON.stringify(app.domains))
                  await backend.mutation(backendApi.apps.patch, {
                    tenantId,
                    appId: app.appId,
                    domains,
                    updatedAt,
                  });
              }
            } catch (error) {
              console.warn("[Apps] reconcile failed", {
                appId: app.appId,
                error,
              });
            }
          }),
      );
    const reconciled = await backend.query(backendApi.apps.list, { tenantId });
    return json({
      apps: await Promise.all(
        reconciled.map(async (app) => {
          const deployment = app.currentDeploymentId
            ? await backend.query(backendApi.appDeployments.get, {
                tenantId,
                appId: app.appId,
                deploymentId: app.currentDeploymentId,
              })
            : null;
          return {
            ...app,
            observedStatus: visibleAppStatus(
              app.observedStatus,
              deployment?.status,
            ),
            accessTokens: app.accessTokens.map(
              ({ tokenHash: _hash, ...token }) => token,
            ),
          };
        }),
      ),
    });
  } catch (error) {
    console.error("[Apps] list failed", error);
    return json({ error: "apps_unavailable" }, { status: 500 });
  }
}

const createSchema = z.object({
  repository: z.string().trim().min(3).max(300),
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  ref: z.string().trim().min(1).max(240),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  plan: z.object({
    kind: z.string(),
    rootDirectory: z
      .string()
      .max(240)
      .regex(/^(?:\.|(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+)$/),
    buildCommand: z.string().max(500).optional(),
    startCommand: z.string().max(500).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    imageRef: z.string().max(500).optional(),
    dockerfilePath: z
      .string()
      .max(240)
      .regex(/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/)
      .optional(),
    dockerBuildTarget: z
      .string()
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    runtimeEnv: z
      .record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(1000))
      .optional(),
    generatedSecretNames: z
      .array(z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/))
      .max(20)
      .optional(),
  }),
  secretNames: z
    .array(z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/))
    .max(100)
    .default([]),
  requestId: z.string().uuid(),
});
const INFRA_SECRET =
  /^(FLY_|KODY_MASTER_KEY$|KODY_SERVICE_KEY$|GITHUB_TOKEN$|GH_TOKEN$)/;
export async function POST(req: NextRequest) {
  const access = await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return access;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return json(
      {
        error: "invalid_app",
        message: parsed.error.issues.map((issue) => issue.message).join(" "),
      },
      { status: 400 },
    );
  const { auth, octokit, actorLogin } = access;
  const tenantId = `${auth.owner}/${auth.repo}`,
    input = parsed.data;
  let source: ReturnType<typeof parseGitHubRepository>;
  try {
    source = parseGitHubRepository(input.repository);
  } catch {
    return json({ error: "invalid_github_repository" }, { status: 400 });
  }
  if (
    !(await checkAppRateLimit({
      tenantId,
      actor: actorLogin,
      action: "create",
      windowSec: 3600,
      limit: 10,
    }))
  )
    return json({ error: "rate_limited" }, { status: 429 });
  const backend = createBackendClient();
  const existingRequest = await backend.query(
    backendApi.appDeployments.getByRequest,
    { tenantId, requestId: input.requestId },
  );
  if (existingRequest)
    return json(
      {
        appId: existingRequest.appId,
        deploymentId: existingRequest.deploymentId,
        status: existingRequest.status,
        idempotent: true,
      },
      { status: 202 },
    );
  const inspected = await inspectRepositoryApp({
    octokit,
    owner: source.owner,
    repo: source.repo,
    ref: input.commitSha,
    rootDirectory: input.plan.rootDirectory,
    name: input.name,
  }).catch(() => null);
  if (
    !inspected ||
    inspected.commitSha !== input.commitSha ||
    inspected.slug !== input.slug
  )
    return json(
      {
        error: "app_inspection_stale",
        message:
          "Repository detection changed. Inspect the App again before approval.",
      },
      { status: 409 },
    );
  if (inspected.plan.kind === "unsupported" || inspected.plan.questions?.length)
    return json(
      {
        error: "app_source_ambiguous",
        questions: inspected.plan.questions ?? [],
      },
      { status: 409 },
    );
  const effectivePlan = inspected.plan;
  const cfg = resolveAppHostingConfig();
  if (!cfg) return json({ error: "app_hosting_unavailable" }, { status: 503 });
  let launchVerifyKey: string;
  try {
    launchVerifyKey = deriveAppLaunchKey().toString("hex");
  } catch {
    return json({ error: "app_launch_signing_unavailable" }, { status: 503 });
  }
  let vault = await readVault(octokit, auth.owner, auth.repo);
  const secretPlan = planAppRuntimeSecrets({
    requestedNames: inspected.requiredSecretNames,
    generatedNames: effectivePlan.generatedSecretNames,
    vaultValues: Object.fromEntries(
      Object.entries(vault.doc.secrets).map(([name, secret]) => [
        name,
        secret.value,
      ]),
    ),
    generateValue: () => crypto.randomBytes(32).toString("base64url"),
  });
  if (secretPlan.missingNames.length)
    return json(
      { error: "missing_app_secrets", names: secretPlan.missingNames },
      { status: 409 },
    );
  for (const [name, value] of Object.entries(secretPlan.generatedValues)) {
    await upsertSecret({
      octokit,
      owner: auth.owner,
      repo: auth.repo,
      name,
      value,
      actorLogin,
    });
  }
  if (Object.keys(secretPlan.generatedValues).length)
    vault = await readVault(octokit, auth.owner, auth.repo, { force: true });
  const appSecretNames = secretPlan.secretNames;
  const runtimeSecrets = Object.fromEntries(
    appSecretNames
      .filter((name) => !INFRA_SECRET.test(name))
      .map((name) => [name, vault.doc.secrets[name]!.value]),
  );
  const now = new Date().toISOString(),
    appId = crypto.randomUUID(),
    deploymentId = crypto.randomUUID();
  const accessToken = generateAppAccessToken(),
    tokenId = crypto.randomUUID(),
    tokenHash = hashAppAccessToken(accessToken),
    callbackToken = generateAppAccessToken();
  const callbackOrigin =
    process.env.KODY_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : req.nextUrl.origin);
  const appName = generateFlyAppName(tenantId, input.slug);
  await backend.mutation(backendApi.apps.create, {
    tenantId,
    appId,
    name: input.name,
    slug: input.slug,
    repository: source.fullName,
    branch: input.ref,
    rootDirectory: effectivePlan.rootDirectory,
    detectedConfig: effectivePlan,
    desiredStatus: "running",
    observedStatus: "provisioning",
    provider: { kind: "fly", appName, publicUrl: `https://${appName}.fly.dev` },
    exposure: "private",
    accessTokens: [
      { tokenId, name: "Default consumer", tokenHash, createdAt: now },
    ],
    secretNames: appSecretNames,
    domains: [],
    storage: [],
    createdBy: actorLogin,
    createdAt: now,
    updatedAt: now,
  });
  await backend.mutation(backendApi.apps.beginAction, {
    tenantId,
    appId,
    requestId: input.requestId,
    action: "create",
    startedAt: now,
  });
  await backend.mutation(backendApi.appDeployments.reserve, {
    tenantId,
    appId,
    deploymentId,
    requestId: input.requestId,
    commitSha: input.commitSha,
    buildPlan: effectivePlan,
    imageRef: `registry.fly.io/${appName}:${input.commitSha.slice(0, 12)}`,
    status: "queued",
    stages: [{ name: "queued", status: "complete", at: now }],
    requestedBy: actorLogin,
    callbackTokenHash: hashAppAccessToken(callbackToken),
    createdAt: now,
    updatedAt: now,
  });
  try {
    const spawned = await spawnAppBuilder({
      repo: source.fullName,
      ref: input.commitSha,
      appName,
      imageTag: input.commitSha.slice(0, 12),
      buildPlan: effectivePlan,
      exposure: "private",
      tokenHashes: [tokenHash],
      runtimeSecrets,
      runtimeEnv: effectivePlan.runtimeEnv ?? {},
      callback: {
        url: `${callbackOrigin}/api/kody/apps/events`,
        token: callbackToken,
        tenantId,
        appId,
        deploymentId,
        requestId: input.requestId,
      },
      launch: { repository: tenantId, appId, verifyKey: launchVerifyKey },
      flyToken: cfg.token,
      flyOrgSlug: cfg.orgSlug,
      flyRegion: cfg.defaultRegion,
      githubToken: auth.token,
      ...(process.env.KODY_APP_GATEWAY_IMAGE
        ? { gatewayImage: process.env.KODY_APP_GATEWAY_IMAGE }
        : {}),
    });
    const updatedAt = new Date().toISOString();
    await backend.mutation(backendApi.appDeployments.update, {
      tenantId,
      appId,
      deploymentId,
      status: "building",
      builderMachineId: spawned.machineId,
      updatedAt,
    });
    await backend.mutation(backendApi.apps.patch, {
      tenantId,
      appId,
      currentDeploymentId: deploymentId,
      provider: {
        kind: "fly",
        appName,
        publicUrl: spawned.expectedUrl,
        builderMachineId: spawned.machineId,
      },
      updatedAt,
    });
    return json(
      {
        appId,
        slug: input.slug,
        deploymentId,
        status: "building",
        accessToken,
      },
      { status: 202 },
    );
  } catch (error) {
    const failedAt = new Date().toISOString();
    await backend.mutation(backendApi.appDeployments.update, {
      tenantId,
      appId,
      deploymentId,
      status: "failed",
      error: { code: "builder_spawn_failed" },
      updatedAt: failedAt,
      completedAt: failedAt,
    });
    await backend.mutation(backendApi.apps.transition, {
      tenantId,
      appId,
      observedStatus: "failed",
      updatedAt: failedAt,
    });
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId,
      requestId: input.requestId,
      updatedAt: failedAt,
    });
    console.error("[Apps] builder spawn failed", error);
    return json({ error: "app_setup_failed" }, { status: 502 });
  }
}
