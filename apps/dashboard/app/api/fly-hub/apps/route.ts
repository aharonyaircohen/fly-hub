import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { inspectPublicGitHubApp } from "@kody-ade/fly/hub/app-source";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import {
  appExists,
  listAppsByPrefix,
  listMachines,
} from "@kody-ade/fly/apps/machines-client";
import {
  getPreviewBuilderStatus,
  spawnAppBuilder,
} from "@kody-ade/fly/apps/builder-client";

export const runtime = "nodejs";
const builderHost = () =>
  process.env.FLY_HUB_BUILDER_HOST_APP?.trim() || "kody-preview-builder";

export async function GET(req: NextRequest) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  try {
    const names = await listAppsByPrefix("flyhub-app-", auth.cfg);
    const apps = await Promise.all(
      names.map(async (appName) => {
        const machines = await listMachines(appName, auth.cfg).catch(() => []);
        const gateway = machines.find(
          (machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH,
        );
        if (!gateway) return null;
        const env = gateway.config?.env ?? {};
        return {
          appName,
          name: env.FLY_HUB_NAME || appName,
          repository: env.FLY_HUB_SOURCE_REPO || "",
          commitSha: env.FLY_HUB_COMMIT_SHA || "",
          state: gateway.state,
          url: `https://${appName}.fly.dev`,
        };
      }),
    );
    const pendingName = req.nextUrl.searchParams.get("pending");
    const pendingStatus =
      pendingName && /^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/.test(pendingName)
        ? await getPreviewBuilderStatus(
            pendingName,
            auth.cfg.token,
            builderHost(),
          )
        : null;
    const pendingApp = apps.find((app) => app?.appName === pendingName);
    const pendingReady =
      pendingApp?.state === "started"
        ? await fetch(`https://${pendingName}.fly.dev/_kody/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(4_000),
          }).then(
            (response) => response.ok,
            () => false,
          )
        : false;
    return NextResponse.json(
      { apps: apps.filter(Boolean), pendingStatus, pendingReady },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not list apps." },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    rootDirectory?: unknown;
    commitSha?: unknown;
  } | null;
  if (
    typeof body?.url !== "string" ||
    body.url.length > 500 ||
    (body.rootDirectory !== undefined &&
      (typeof body.rootDirectory !== "string" ||
        body.rootDirectory.length > 200)) ||
    typeof body.commitSha !== "string"
  )
    return NextResponse.json(
      { error: "Invalid app setup request." },
      { status: 400 },
    );
  try {
    const inspected = await inspectPublicGitHubApp({
      url: body.url,
      org: auth.cfg.orgSlug,
      rootDirectory: body.rootDirectory as string | undefined,
    });
    if (inspected.commitSha !== body.commitSha)
      return NextResponse.json(
        { error: "The repository changed. Inspect it again before deploying." },
        { status: 409 },
      );
    if (
      inspected.plan.kind === "unsupported" ||
      inspected.plan.questions?.length
    )
      return NextResponse.json(
        {
          error:
            inspected.plan.questions?.[0] ??
            "This repository cannot be deployed automatically yet.",
        },
        { status: 400 },
      );
    if (inspected.requiredSecretNames.length)
      return NextResponse.json(
        {
          error: `Add required secrets before deployment: ${inspected.requiredSecretNames.join(", ")}`,
        },
        { status: 400 },
      );
    if (inspected.plan.generatedSecretNames?.length)
      return NextResponse.json(
        {
          error: `Secret setup is required before deployment: ${inspected.plan.generatedSecretNames.join(", ")}`,
        },
        { status: 400 },
      );
    if (await appExists(inspected.appName, auth.cfg)) {
      const machines = await listMachines(inspected.appName, auth.cfg);
      if (
        machines.some((machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH)
      )
        return NextResponse.json(
          { error: "This repository already has an app in Fly Hub." },
          { status: 409 },
        );
    }
    if (
      (
        await getPreviewBuilderStatus(
          inspected.appName,
          auth.cfg.token,
          builderHost(),
        )
      )?.state === "building"
    )
      return NextResponse.json(
        { error: "This repository is already being built." },
        { status: 409 },
      );
    const builderImage = process.env.FLY_HUB_BUILDER_IMAGE?.trim();
    if (!builderImage)
      return NextResponse.json(
        {
          error:
            "Fly Hub's password-capable app builder has not been configured.",
        },
        { status: 503 },
      );
    if (!(await appExists(builderHost(), auth.cfg)))
      return NextResponse.json(
        {
          error:
            "Fly Hub's app builder is not installed in this Fly organization.",
        },
        { status: 503 },
      );
    const password = crypto.randomBytes(24).toString("base64url");
    const passwordHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    const launchKey = crypto.randomBytes(32).toString("hex");
    await spawnAppBuilder({
      repo: inspected.repository,
      ref: inspected.commitSha,
      appName: inspected.appName,
      imageTag: inspected.commitSha.slice(0, 12),
      buildPlan: inspected.plan,
      exposure: "private",
      tokenHashes: [],
      flyHubPasswordHash: passwordHash,
      flyHubName: inspected.name,
      builderHostApp: builderHost(),
      builderImage,
      runtimeSecrets: {},
      runtimeEnv: inspected.plan.runtimeEnv ?? {},
      flyToken: auth.cfg.token,
      flyOrgSlug: auth.cfg.orgSlug,
      flyRegion: auth.cfg.defaultRegion,
      launch: {
        repository: inspected.repository,
        appId: inspected.appName,
        verifyKey: launchKey,
      },
    });
    return NextResponse.json(
      {
        appName: inspected.appName,
        url: `https://${inspected.appName}.fly.dev`,
        password,
        status: "building",
        instructions:
          "Check app status until pendingReady is true. Open the URL and enter the shared password. Use Apps in Fly Hub to reset it later.",
        message:
          "Save this password now. Fly Hub cannot display it again; you can reset it later.",
      },
      { status: 202, headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    console.error(
      "[fly-hub] app setup failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error:
          "Could not start app deployment. Check the repository and Fly builder.",
      },
      { status: 502 },
    );
  }
}
