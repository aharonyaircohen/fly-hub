import crypto from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { readVault } from "@kody-ade/base/vault/store";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  generateAppAccessToken,
  hashAppAccessToken,
} from "@kody-ade/fly/apps/access-token";
import { deriveAppLaunchKey } from "@kody-ade/fly/apps/access-ticket";
import { spawnAppBuilder } from "@kody-ade/fly/apps/builder-client";
import { resolveAppHostingConfig } from "@kody-ade/fly/apps/config";
import { parseGitHubRepository } from "./source-repository";

const INFRA_SECRET =
  /^(FLY_|KODY_MASTER_KEY$|KODY_SERVICE_KEY$|GITHUB_TOKEN$|GH_TOKEN$)/;

type BuildPlan = {
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
  verification?: { path: string; expectedStatus: number };
};

type ManagedApp = {
  appId: string;
  repository: string;
  provider: { appName: string };
  exposure: "private" | "public";
  accessTokens: Array<{ tokenHash: string; revokedAt?: string }>;
  secretNames: string[];
  storage: Array<{ volumeId: string; mountPath: string }>;
};

export class AppDeploymentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function startAppDeployment(input: {
  access: {
    auth: { owner: string; repo: string; token: string };
    actorLogin: string;
    octokit: Octokit;
  };
  tenantId: string;
  app: ManagedApp;
  requestId: string;
  commitSha: string;
  buildPlan: BuildPlan;
  callbackOrigin: string;
  action: "deploy" | "rollback" | "start_repair";
}): Promise<{ deploymentId: string; status: "building" }> {
  const { access, tenantId, app, requestId, commitSha, buildPlan } = input;
  const source = parseGitHubRepository(app.repository);
  const commit = await access.octokit.rest.repos
    .getCommit({ owner: source.owner, repo: source.repo, ref: commitSha })
    .catch(() => null);
  if (!commit || commit.data.sha !== commitSha)
    throw new AppDeploymentError("commit_not_found", 409);

  const cfg = resolveAppHostingConfig();
  if (!cfg) throw new AppDeploymentError("app_hosting_unavailable", 503);

  let launchVerifyKey: string;
  try {
    launchVerifyKey = deriveAppLaunchKey().toString("hex");
  } catch {
    throw new AppDeploymentError("app_launch_signing_unavailable", 503);
  }

  const vault = await readVault(
    access.octokit,
    access.auth.owner,
    access.auth.repo,
  );
  const missing = app.secretNames.filter(
    (name) => !vault.doc.secrets[name]?.value,
  );
  if (missing.length)
    throw new AppDeploymentError("missing_app_secrets", 409, {
      names: missing,
    });

  const runtimeSecrets = Object.fromEntries(
    app.secretNames
      .filter((name) => !INFRA_SECRET.test(name))
      .map((name) => [name, vault.doc.secrets[name]!.value]),
  );
  const backend = createBackendClient();
  const deploymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const callbackToken = generateAppAccessToken();
  try {
    await backend.mutation(backendApi.apps.beginAction, {
      tenantId,
      appId: app.appId,
      requestId,
      action: input.action,
      startedAt: now,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("APP_ACTION_CONFLICT"))
      throw new AppDeploymentError("app_action_conflict", 409);
    throw error;
  }

  await backend.mutation(backendApi.appDeployments.reserve, {
    tenantId,
    appId: app.appId,
    deploymentId,
    requestId,
    commitSha,
    buildPlan,
    imageRef: `registry.fly.io/${app.provider.appName}:${commitSha.slice(0, 12)}`,
    status: "queued",
    stages: [{ name: `${input.action}_queued`, status: "complete", at: now }],
    requestedBy: access.actorLogin,
    callbackTokenHash: hashAppAccessToken(callbackToken),
    createdAt: now,
    updatedAt: now,
  });

  try {
    const spawned = await spawnAppBuilder({
      repo: app.repository,
      ref: commitSha,
      appName: app.provider.appName,
      imageTag: commitSha.slice(0, 12),
      buildPlan,
      exposure: app.exposure,
      tokenHashes: app.accessTokens
        .filter((token) => !token.revokedAt)
        .map((token) => token.tokenHash),
      runtimeSecrets,
      runtimeEnv: buildPlan.runtimeEnv ?? {},
      storage: app.storage.map((volume) => ({
        volumeId: volume.volumeId,
        mountPath: volume.mountPath,
      })),
      callback: {
        url: `${input.callbackOrigin}/api/kody/apps/events`,
        token: callbackToken,
        tenantId,
        appId: app.appId,
        deploymentId,
        requestId,
      },
      launch: {
        repository: tenantId,
        appId: app.appId,
        verifyKey: launchVerifyKey,
      },
      flyToken: cfg.token,
      flyOrgSlug: cfg.orgSlug,
      flyRegion: cfg.defaultRegion,
      githubToken: access.auth.token,
      ...(process.env.KODY_APP_GATEWAY_IMAGE
        ? { gatewayImage: process.env.KODY_APP_GATEWAY_IMAGE }
        : {}),
    });
    const updatedAt = new Date().toISOString();
    await backend.mutation(backendApi.appDeployments.update, {
      tenantId,
      appId: app.appId,
      deploymentId,
      status: "building",
      builderMachineId: spawned.machineId,
      updatedAt,
    });
    await backend.mutation(backendApi.apps.patch, {
      tenantId,
      appId: app.appId,
      currentDeploymentId: deploymentId,
      updatedAt,
    });
    await backend.mutation(backendApi.apps.transition, {
      tenantId,
      appId: app.appId,
      desiredStatus: "running",
      observedStatus: "deploying",
      updatedAt,
    });
    return { deploymentId, status: "building" };
  } catch (error) {
    const failedAt = new Date().toISOString();
    console.error(
      "[Apps] builder spawn failed",
      error instanceof Error ? error.message : "unknown error",
    );
    await backend.mutation(backendApi.appDeployments.update, {
      tenantId,
      appId: app.appId,
      deploymentId,
      status: "failed",
      error: { code: "builder_spawn_failed" },
      updatedAt: failedAt,
      completedAt: failedAt,
    });
    await backend.mutation(backendApi.apps.endAction, {
      tenantId,
      appId: app.appId,
      requestId,
      updatedAt: failedAt,
    });
    if (error instanceof AppDeploymentError) throw error;
    throw new AppDeploymentError("app_setup_failed", 502);
  }
}
