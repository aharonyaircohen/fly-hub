import crypto from "node:crypto";
import { encrypt } from "@kody-ade/base/vault/crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  flyHubAppName,
  inspectPublicGitHubApp,
} from "@kody-ade/fly/hub/app-source";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import { readEvePlanHandle } from "./agent/route";
import { callEveStudioTool } from "@dashboard/lib/eve-studio-client";
import { parseEveAppPlan, type EveAppPlan } from "@dashboard/lib/eve-app-plan";
import { readFlyHubEveTask } from "@dashboard/lib/fly-hub-eve-task";
import {
  taskBuildSchema,
  type FlyHubTaskBuild,
} from "@dashboard/lib/fly-hub-task-build";
import {
  appExists,
  listAppsByPrefix,
  listMachines,
} from "@kody-ade/fly/apps/machines-client";
import {
  getPreviewBuilderStatus,
  spawnAppBuilder,
} from "@kody-ade/fly/apps/builder-client";

import {
  deployedAppState,
  runtimeAppName,
} from "@dashboard/lib/fly-hub-app-run-status";

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
        const runtimeMachines = await listMachines(
          runtimeAppName(appName),
          auth.cfg,
        );
        return {
          appName,
          name: env.FLY_HUB_NAME || appName,
          repository: env.FLY_HUB_SOURCE_REPO || "",
          commitSha: env.FLY_HUB_COMMIT_SHA || "",
          state: deployedAppState(
            gateway.state,
            runtimeMachines.map((machine) => machine.state),
          ),
          gatewayState: gateway.state,
          runtimeStates: runtimeMachines.map((machine) => machine.state),
          url: `https://${appName}.fly.dev`,
          passwordAvailable: Boolean(env.FLY_HUB_PASSWORD_ENCRYPTED),
          appCredentialName: env.FLY_HUB_APP_PASSWORD_ENV || null,
          alwaysOn: env.FLY_HUB_ALWAYS_ON === "1",
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
    eveHandle?: unknown;
    runtimeSecrets?: unknown;
    taskGrant?: unknown;
    taskBuild?: unknown;
    alwaysOn?: unknown;
  } | null;
  const fromEve = typeof body?.eveHandle === "string";
  const fromTask = typeof body?.taskGrant === "string";
  if (
    !body ||
    (body.alwaysOn !== undefined && typeof body.alwaysOn !== "boolean") ||
    (fromTask
      ? (body.taskGrant as string).length > 4_096
      : fromEve
        ? (body.eveHandle as string).length > 4_096
        : typeof body.url !== "string" ||
          body.url.length > 500 ||
          (body.rootDirectory !== undefined &&
            (typeof body.rootDirectory !== "string" ||
              body.rootDirectory.length > 200)) ||
          typeof body.commitSha !== "string")
  )
    return NextResponse.json(
      { error: "Invalid app setup request." },
      { status: 400 },
    );
  try {
    let evePlan: EveAppPlan | null = null;
    let taskBuild: FlyHubTaskBuild | null = null;
    const task = fromTask ? readFlyHubEveTask(body.taskGrant as string) : null;
    let alwaysOn = task?.alwaysOn ?? body.alwaysOn === true;
    if (fromTask) {
      if (
        !task ||
        task.orgSlug !== auth.cfg.orgSlug ||
        task.token !== auth.cfg.token
      )
        return NextResponse.json(
          { error: "Invalid Eve deployment task." },
          { status: 403 },
        );
      const parsed = taskBuildSchema.safeParse(body.taskBuild);
      if (!parsed.success)
        return NextResponse.json(
          {
            error:
              parsed.error.issues[0]?.message ?? "Invalid build instructions.",
          },
          { status: 400 },
        );
      taskBuild = parsed.data;
    }
    let url = task
      ? `https://github.com/${task.repository}`
      : (body.url as string);
    let commitSha = task?.commitSha ?? (body.commitSha as string);
    let rootDirectory =
      taskBuild?.rootDirectory ?? (body.rootDirectory as string | undefined);
    let suppliedSecrets: Record<string, string> = {};
    if (fromEve) {
      try {
        const handle = readEvePlanHandle(
          body.eveHandle as string,
          auth.cfg.orgSlug,
        );
        alwaysOn = handle.alwaysOn === true;
        if (!handle.commitSha)
          throw new Error(
            "Eve could not pin a repository commit. Inspect it again.",
          );
        url = handle.url;
        commitSha = handle.commitSha;
        const state = await callEveStudioTool("agent_get", {
          agentId: handle.agentId,
          invocationId: handle.invocationId,
        });
        if (state.status !== "completed")
          throw new Error("Eve has not finished the deployment plan.");
        evePlan = parseEveAppPlan(state.result);
        rootDirectory = evePlan.rootDirectory;
        if (evePlan.questions.length)
          throw new Error(
            `Resolve Eve's setup questions first: ${evePlan.questions[0]}`,
          );
        if (
          !body.runtimeSecrets ||
          typeof body.runtimeSecrets !== "object" ||
          Array.isArray(body.runtimeSecrets)
        )
          throw new Error("Provide the required app secrets.");
        suppliedSecrets = body.runtimeSecrets as Record<string, string>;
        if (
          Object.keys(suppliedSecrets).length > 20 ||
          Object.entries(suppliedSecrets).some(
            ([key, value]) =>
              !/^[A-Z_][A-Z0-9_]{0,99}$/.test(key) ||
              typeof value !== "string" ||
              value.length > 4_096,
          )
        )
          throw new Error("Invalid app secrets.");
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "Invalid Eve plan.",
          },
          { status: 400 },
        );
      }
    }
    const inspected = await inspectPublicGitHubApp({
      url,
      org: auth.cfg.orgSlug,
      rootDirectory,
      ...(fromEve || fromTask ? { commitSha } : {}),
    });
    const [taskOwner, taskRepo] = task?.repository.split("/") ?? [];
    const appName =
      task && taskOwner && taskRepo
        ? flyHubAppName(task.orgSlug, taskOwner, taskRepo, ".")
        : inspected.appName;
    if (inspected.commitSha !== commitSha)
      return NextResponse.json(
        { error: "The repository changed. Inspect it again before deploying." },
        { status: 409 },
      );
    if (evePlan && inspected.plan.kind === "unsupported")
      return NextResponse.json(
        { error: "Eve's selected directory has no supported build source." },
        { status: 400 },
      );
    if (
      taskBuild &&
      inspected.plan.kind === "unsupported" &&
      !taskBuild.dockerfileContent
    )
      return NextResponse.json(
        { error: "Supply a Dockerfile for this repository." },
        { status: 400 },
      );
    if (
      !evePlan &&
      !taskBuild &&
      (inspected.plan.kind === "unsupported" ||
        inspected.plan.questions?.length)
    )
      return NextResponse.json(
        {
          error:
            inspected.plan.questions?.[0] ??
            "This repository cannot be deployed automatically yet.",
        },
        { status: 400 },
      );
    if (!evePlan && !taskBuild && inspected.requiredSecretNames.length)
      return NextResponse.json(
        {
          error: `Add required secrets before deployment: ${inspected.requiredSecretNames.join(", ")}`,
        },
        { status: 400 },
      );
    if (!evePlan && !taskBuild && inspected.plan.generatedSecretNames?.length)
      return NextResponse.json(
        {
          error: `Secret setup is required before deployment: ${inspected.plan.generatedSecretNames.join(", ")}`,
        },
        { status: 400 },
      );
    if (await appExists(appName, auth.cfg)) {
      const machines = await listMachines(appName, auth.cfg);
      if (
        !taskBuild &&
        machines.some((machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH)
      )
        return NextResponse.json(
          { error: "This repository already has an app in Fly Hub." },
          { status: 409 },
        );
    }
    if (
      (await getPreviewBuilderStatus(appName, auth.cfg.token, builderHost()))
        ?.state === "building"
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
    const taskPassword = (label: string) =>
      crypto
        .createHmac("sha256", Buffer.from(task!.passwordSeed, "hex"))
        .update(label)
        .digest("base64url")
        .slice(0, 32);
    const password = task
      ? taskPassword("outer")
      : crypto.randomBytes(24).toString("base64url");
    const appPassword =
      evePlan?.appPasswordEnv || taskBuild?.appPasswordEnv
        ? task
          ? taskPassword("inner")
          : crypto.randomBytes(24).toString("base64url")
        : null;
    const passwordHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    const launchKey = crypto.randomBytes(32).toString("hex");
    const requiredSecrets = [
      ...new Set([
        ...(!taskBuild ? inspected.requiredSecretNames : []),
        ...(evePlan?.requiredSecrets ?? []),
      ]),
    ].filter(
      (name) =>
        name !== evePlan?.appPasswordEnv &&
        !evePlan?.generatedSecrets.includes(name),
    );
    if (requiredSecrets.some((name) => !suppliedSecrets[name]?.trim()))
      return NextResponse.json(
        {
          error: `Provide required app secrets: ${requiredSecrets.filter((name) => !suppliedSecrets[name]?.trim()).join(", ")}`,
        },
        { status: 400 },
      );
    if (
      Object.keys(suppliedSecrets).some(
        (name) => !requiredSecrets.includes(name),
      )
    )
      return NextResponse.json(
        { error: "The secret list changed. Plan the app again." },
        { status: 400 },
      );
    const runtimeSecrets: Record<string, string> = { ...suppliedSecrets };
    for (const name of [
      ...(evePlan?.generatedSecrets ?? []),
      ...(taskBuild?.generatedSecrets ?? []),
    ])
      runtimeSecrets[name] = task
        ? taskPassword(`generated:${name}`)
        : crypto.randomBytes(32).toString("base64url");
    if (evePlan?.appPasswordEnv && appPassword)
      runtimeSecrets[evePlan.appPasswordEnv] = appPassword;
    if (taskBuild?.appPasswordEnv && appPassword)
      runtimeSecrets[taskBuild.appPasswordEnv] = appPassword;
    const buildPlan = evePlan
      ? {
          ...inspected.plan,
          ...(evePlan.startCommand
            ? { startCommand: evePlan.startCommand }
            : {}),
          ...(evePlan.port ? { port: evePlan.port } : {}),
          ...(evePlan.persistentPaths[0]
            ? { storagePath: evePlan.persistentPaths[0] }
            : {}),
          verification: { path: evePlan.verificationPath, expectedStatus: 200 },
        }
      : taskBuild
        ? {
            ...inspected.plan,
            ...(taskBuild.dockerfileContent
              ? {
                  kind: "dockerfile",
                  imageRef: undefined,
                  dockerfilePath: undefined,
                  dockerBuildTarget: undefined,
                }
              : {}),
            rootDirectory: taskBuild.rootDirectory,
            ...(taskBuild.dockerfileContent
              ? { customDockerfile: taskBuild.dockerfileContent }
              : {}),
            ...(taskBuild.startCommand
              ? { startCommand: taskBuild.startCommand }
              : {}),
            port: taskBuild.port,
            ...(taskBuild.storagePath
              ? { storagePath: taskBuild.storagePath }
              : {}),
            verification: {
              path: taskBuild.verificationPath,
              expectedStatus: 200,
            },
          }
        : inspected.plan;
    if (
      evePlan &&
      (!buildPlan.port ||
        (inspected.plan.questions?.length && !evePlan.startCommand))
    )
      return NextResponse.json(
        { error: "Eve's plan needs a web command and port before deployment." },
        { status: 400 },
      );
    await spawnAppBuilder({
      repo: inspected.repository,
      ref: inspected.commitSha,
      appName,
      imageTag: inspected.commitSha.slice(0, 12),
      buildPlan,
      exposure: "private",
      alwaysOn,
      tokenHashes: [],
      flyHubPasswordHash: passwordHash,
      flyHubPasswordEncrypted: encrypt(password),
      flyHubName: inspected.name,
      flyHubAppPasswordEnv:
        evePlan?.appPasswordEnv ?? taskBuild?.appPasswordEnv,
      flyHubAppPasswordEncrypted: appPassword
        ? encrypt(appPassword)
        : undefined,
      builderHostApp: builderHost(),
      builderImage,
      runtimeSecrets,
      runtimeEnv: {
        ...(inspected.plan.runtimeEnv ?? {}),
        ...(evePlan?.runtimeEnv ?? {}),
        ...(taskBuild?.runtimeEnv ?? {}),
      },
      flyToken: auth.cfg.token,
      flyOrgSlug: auth.cfg.orgSlug,
      flyRegion: auth.cfg.defaultRegion,
      launch: {
        repository: inspected.repository,
        appId: appName,
        verifyKey: launchKey,
      },
    });
    return NextResponse.json(
      {
        appName,
        url: `https://${appName}.fly.dev`,
        password,
        appCredential:
          evePlan?.appPasswordEnv || taskBuild?.appPasswordEnv
            ? {
                name: evePlan?.appPasswordEnv ?? taskBuild?.appPasswordEnv,
                password: appPassword,
              }
            : null,
        status: "building",
        instructions: [
          evePlan?.summary,
          evePlan?.usage,
          evePlan?.credentialNotes,
          "Wait until the app is ready, then open the URL. Enter the Fly Hub shared password at the outer gate. If the app has its own login, use the separate app credential shown here. Reset password in Fly Hub changes only the outer gate.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        message: appPassword
          ? "Save both passwords now. Fly Hub can reset the outer gate password later; it cannot display the app login password again."
          : "Save this password now. Fly Hub cannot display it again; you can reset it later.",
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
