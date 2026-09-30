import { spawn } from "node:child_process";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  allocateSharedIps,
  allocatePrivateIp,
  appExists,
  cordonMachine,
  createApp,
  createPreviewMachine,
  destroyMachine,
  listMachines,
  snapshotVolume,
  startMachine,
  stopMachine,
  uncordonMachine,
  waitForMachineStarted,
} from "./fly-api.ts";
import { appDeployConfig } from "./app-deploy-config.ts";
import { runtimeAppName } from "./app-builder-names.ts";
import {
  waitForAppVerification,
  type AppVerification,
} from "./app-verification.ts";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const exists = async (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
let recentOutput = "";
function rememberOutput(value: string) {
  recentOutput = (recentOutput + value).slice(-12_000);
}
function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; input?: string } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      rememberOutput(value);
      process.stdout.write(value);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      rememberOutput(value);
      process.stderr.write(value);
    });
    if (options.input) {
      child.stdin?.end(options.input);
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
function runOutput(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      rememberOutput(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      rememberOutput(chunk.toString());
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
type Plan = {
  kind: string;
  rootDirectory: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  apiPort?: number;
  imageRef?: string;
  dockerfilePath?: string;
  customDockerfile?: string;
  dockerBuildTarget?: string;
  runtimeEnv?: Record<string, string>;
  generatedSecretNames?: string[];
  storagePath?: string;
  verification?: AppVerification;
};
type Storage = { volumeId: string; mountPath: string };
type Callback = {
  url: string;
  token: string;
  tenantId: string;
  appId: string;
  deploymentId: string;
  requestId: string;
};
async function notify(
  status: "verifying" | "running" | "failed",
  detail: Record<string, unknown> = {},
) {
  const raw = process.env.APP_CALLBACK_JSON;
  if (!raw) return;
  try {
    const callback = JSON.parse(raw) as Callback;
    const response = await fetch(callback.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${callback.token}`,
      },
      body: JSON.stringify({
        tenantId: callback.tenantId,
        appId: callback.appId,
        deploymentId: callback.deploymentId,
        requestId: callback.requestId,
        status,
        ...detail,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      console.error(`[app-builder] callback HTTP ${response.status}`);
  } catch (error) {
    console.error("[app-builder] callback failed", error);
  }
}
async function waitApplicationHealthy(url: string) {
  let last = "unreachable";
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status < 500) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`APP_HEALTH_CHECK_FAILED: ${last}`);
}
function dockerfile(plan: Plan): string {
  const workdir =
    plan.rootDirectory === "." ? "/app" : `/app/${plan.rootDirectory}`;
  if (plan.kind === "static")
    return `FROM nginx:alpine\nCOPY ${plan.rootDirectory === "." ? "." : plan.rootDirectory} /usr/share/nginx/html\nRUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf\nEXPOSE 8080\n`;
  if (plan.kind === "python")
    return `FROM python:3.13-slim\nWORKDIR /app\nCOPY . .\nWORKDIR ${workdir}\nRUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; else pip install --no-cache-dir .; fi\nEXPOSE ${plan.port ?? 8000}\nCMD ["sh","-c",${JSON.stringify(plan.startCommand ?? "python app.py")}]\n`;
  return `FROM node:22-alpine\nWORKDIR /app\nRUN corepack enable\nCOPY . .\nRUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; elif [ -f package-lock.json ]; then npm ci; elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; else cd ${plan.rootDirectory} && npm install; fi\nWORKDIR ${workdir}\n${plan.buildCommand ? `RUN ${plan.buildCommand}\n` : ""}EXPOSE ${plan.port ?? 3000}\nCMD ["sh","-c",${JSON.stringify(plan.startCommand ?? "npm start")}]\n`;
}
async function main() {
  const repo = required("REPO"),
    ref = required("REF"),
    appName = required("APP_NAME"),
    imageTag = required("IMAGE_TAG"),
    flyToken = required("FLY_API_TOKEN");
  const plan = JSON.parse(required("APP_BUILD_PLAN_JSON")) as Plan;
  const exposure =
    process.env.KODY_APP_EXPOSURE === "public" ? "public" : "private";
  const runtimeName =
    exposure === "private" ? runtimeAppName(appName) : appName;
  const tokenHashes = process.env.KODY_APP_TOKEN_HASHES ?? "";
  const flyHubPasswordHash = process.env.FLY_HUB_PASSWORD_HASH ?? "";
  const flyHubName = process.env.FLY_HUB_NAME ?? "";
  const flyHubAppPasswordEnv = process.env.FLY_HUB_APP_PASSWORD_ENV ?? "";
  const secrets = JSON.parse(
    process.env.APP_RUNTIME_SECRETS_JSON ?? "{}",
  ) as Record<string, string>;
  const runtimeEnv = JSON.parse(
    process.env.APP_RUNTIME_ENV_JSON ?? "{}",
  ) as Record<string, string>;
  if (plan.apiPort) {
    runtimeEnv.API_URL = `https://${appName}.fly.dev`;
    runtimeEnv.INTERNAL_API_URL = `http://127.0.0.1:${plan.apiPort}`;
  }
  const storage = JSON.parse(process.env.APP_STORAGE_JSON ?? "[]") as Storage[];
  const cwd = "/tmp/app-source";
  await mkdir(cwd, { recursive: true });
  const cloneUrl = process.env.GITHUB_TOKEN
    ? `https://x-access-token:${encodeURIComponent(process.env.GITHUB_TOKEN)}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
  await run("git", ["clone", "--depth=1", "--filter=blob:none", cloneUrl, cwd]);
  try {
    await run("git", ["checkout", ref], { cwd });
  } catch {
    // The branch may have advanced after inspection. Fetch only the pinned
    // commit instead of the repository's entire history.
    await run("git", ["fetch", "--depth=1", "origin", ref], { cwd });
    await run("git", ["checkout", ref], { cwd });
  }
  const appRoot = resolve(cwd, plan.rootDirectory || ".");
  if (plan.customDockerfile) {
    plan.dockerfilePath = "Dockerfile.flyhub-agent";
    await writeFile(
      resolve(appRoot, plan.dockerfilePath),
      plan.customDockerfile,
    );
  }
  const generatedDockerfile =
    !(await exists(resolve(appRoot, "Dockerfile"))) &&
    !plan.dockerfilePath &&
    !plan.imageRef;
  if (generatedDockerfile)
    await writeFile(resolve(cwd, "Dockerfile.kody-app"), dockerfile(plan));
  const deployConfigPath = resolve(cwd, "fly.kody-app.toml");
  await writeFile(
    deployConfigPath,
    appDeployConfig(appName, process.env.FLY_REGION ?? "fra"),
  );
  if (!(await appExists(appName, flyToken)))
    await createApp(appName, process.env.FLY_ORG_SLUG ?? "personal", flyToken);
  if (!(await appExists(runtimeName, flyToken)))
    await createApp(
      runtimeName,
      process.env.FLY_ORG_SLUG ?? "personal",
      flyToken,
    );
  if (exposure === "private") {
    await allocateSharedIps(appName, flyToken);
    await allocatePrivateIp(runtimeName, flyToken);
  } else await allocateSharedIps(runtimeName, flyToken);
  if (plan.storagePath && !storage.length) {
    const env = { FLY_API_TOKEN: flyToken };
    const existing = JSON.parse(
      await runOutput(
        "flyctl",
        ["volumes", "list", "--app", runtimeName, "--json"],
        { env },
      ),
    ) as Array<{ id?: string; name?: string }>;
    let volumeId = existing.find((volume) => volume.name === "flyhub_data")?.id;
    if (!volumeId) {
      const created = JSON.parse(
        await runOutput(
          "flyctl",
          [
            "volumes",
            "create",
            "flyhub_data",
            "--app",
            runtimeName,
            "--region",
            process.env.FLY_REGION ?? "fra",
            "--size",
            "1",
            "--json",
            "--yes",
          ],
          { env },
        ),
      ) as { id?: string } | Array<{ id?: string }>;
      volumeId = Array.isArray(created) ? created[0]?.id : created.id;
    }
    if (!volumeId)
      throw new Error("Could not create the app's storage volume.");
    storage.push({ volumeId, mountPath: plan.storagePath });
  }
  if (Object.keys(secrets).length) {
    const input =
      Object.entries(secrets)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n";
    await run(
      "flyctl",
      ["secrets", "import", "--stage", "--app", runtimeName],
      {
        input,
        env: { FLY_API_TOKEN: flyToken },
      },
    );
  }
  const image = plan.imageRef ?? `registry.fly.io/${runtimeName}:${imageTag}`;
  const args = [
    "deploy",
    "--build-only",
    "--push",
    "--image-label",
    imageTag,
    "--app",
    runtimeName,
    "--config",
    deployConfigPath,
    "--remote-only",
    "--depot=false",
    "--yes",
  ];
  if (plan.dockerfilePath) args.push("--dockerfile", plan.dockerfilePath);
  else if (generatedDockerfile)
    args.push("--dockerfile", "Dockerfile.kody-app");
  if (plan.dockerBuildTarget)
    args.push("--build-target", plan.dockerBuildTarget);
  if (!plan.imageRef)
    await run("flyctl", args, {
      cwd: generatedDockerfile ? cwd : appRoot,
      env: { FLY_API_TOKEN: flyToken, DOCKER_HOST: "tcp://127.0.0.1:2375" },
    });
  let gatewayImage = process.env.KODY_APP_GATEWAY_IMAGE?.trim();
  if (exposure === "private" && !gatewayImage) {
    gatewayImage = `registry.fly.io/${appName}:kody-gateway-v1`;
    await run(
      "flyctl",
      [
        "deploy",
        "--build-only",
        "--push",
        "--image-label",
        "kody-gateway-v1",
        "--app",
        appName,
        "--config",
        deployConfigPath,
        "--remote-only",
        "--depot=false",
        "--yes",
        "--dockerfile",
        "Dockerfile.app-gateway",
      ],
      {
        cwd: "/app",
        env: { FLY_API_TOKEN: flyToken, DOCKER_HOST: "tcp://127.0.0.1:2375" },
      },
    );
  }
  const oldRuntimeMachines = await listMachines(runtimeName, flyToken);
  const oldGatewayMachines =
    exposure === "private" ? await listMachines(appName, flyToken) : [];
  const oldRuntime = oldRuntimeMachines[0],
    oldGateway = oldGatewayMachines.find((machine) =>
      Boolean(
        machine.config?.env?.KODY_APP_TOKEN_HASHES ||
        machine.config?.env?.FLY_HUB_PASSWORD_HASH,
      ),
    );
  if (storage.length) {
    // Fly cannot snapshot a volume until a machine has mounted it. A new app's
    // first volume is empty, so there is no prior state to preserve.
    if (oldRuntimeMachines.length)
      for (const volume of storage)
        await snapshotVolume(runtimeName, volume.volumeId, flyToken);
    for (const prior of [...oldRuntimeMachines, ...oldGatewayMachines]) {
      const owner = oldRuntimeMachines.includes(prior) ? runtimeName : appName;
      await cordonMachine(owner, prior.id, flyToken).catch(() => undefined);
      await stopMachine(owner, prior.id, flyToken).catch(() => undefined);
      await destroyMachine(owner, prior.id, flyToken);
    }
  }
  const machineId = await createPreviewMachine(
    {
      appName: runtimeName,
      region: process.env.FLY_REGION ?? "fra",
      image,
      ...(plan.startCommand &&
      (plan.kind === "dockerfile" || plan.kind === "fly")
        ? { cmd: ["sh", "-lc", plan.startCommand] }
        : {}),
      internalPort: plan.port ?? 3000,
      additionalPorts: plan.apiPort ? [plan.apiPort] : undefined,
      publicServices: true,
      healthCheck: true,
      mounts: storage.map((volume) => ({
        volumeId: volume.volumeId,
        path: volume.mountPath,
      })),
      env: runtimeEnv,
      processGroup: "app",
    },
    flyToken,
  );
  let gatewayId: string | undefined;
  try {
    await startMachine(runtimeName, machineId, flyToken);
    await waitForMachineStarted(runtimeName, machineId, flyToken);
    if (exposure === "private") {
      gatewayId = await createPreviewMachine(
        {
          appName,
          region: process.env.FLY_REGION ?? "fra",
          image: gatewayImage!,
          internalPort: 8080,
          processGroup: "gateway",
          env: {
            KODY_APP_EXPOSURE: exposure,
            KODY_APP_TOKEN_HASHES: tokenHashes,
            ...(flyHubPasswordHash
              ? {
                  FLY_HUB_PASSWORD_HASH: flyHubPasswordHash,
                  FLY_HUB_NAME: flyHubName,
                  FLY_HUB_SOURCE_REPO: repo,
                  FLY_HUB_COMMIT_SHA: ref,
                  ...(flyHubAppPasswordEnv
                    ? { FLY_HUB_APP_PASSWORD_ENV: flyHubAppPasswordEnv }
                    : {}),
                }
              : {}),
            KODY_APP_REPOSITORY: process.env.KODY_APP_REPOSITORY ?? "",
            KODY_APP_ID: process.env.KODY_APP_ID ?? "",
            KODY_APP_LAUNCH_VERIFY_KEY:
              process.env.KODY_APP_LAUNCH_VERIFY_KEY ?? "",
            APP_TARGET_HOST: `${runtimeName}.flycast`,
            APP_INTERNAL_PORT: "80",
            ...(plan.apiPort
              ? { APP_API_INTERNAL_PORT: String(plan.apiPort) }
              : {}),
          },
        },
        flyToken,
      );
      await startMachine(appName, gatewayId, flyToken);
      await waitForMachineStarted(appName, gatewayId, flyToken);
      await uncordonMachine(appName, gatewayId, flyToken);
      await waitApplicationHealthy(`https://${appName}.fly.dev/_kody/health`);
      if (flyHubPasswordHash) {
        const anonymous = await fetch(`https://${appName}.fly.dev/`, {
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
        });
        if (anonymous.status !== 401)
          throw new Error(
            "APP_PASSWORD_GATE_FAILED: anonymous request was not blocked",
          );
      }
      await notify("verifying", {
        runtimeMachineId: machineId,
        gatewayMachineId: gatewayId,
        imageRef: image,
      });
      await waitForAppVerification({
        origin: `https://${appName}.fly.dev`,
        verification: plan.verification ?? { path: "/", expectedStatus: 200 },
        privateAccess: {
          repository: required("KODY_APP_REPOSITORY"),
          appId: required("KODY_APP_ID"),
          verifyKey: Buffer.from(required("KODY_APP_LAUNCH_VERIFY_KEY"), "hex"),
        },
      });
    } else {
      await uncordonMachine(appName, machineId, flyToken);
      await notify("verifying", {
        runtimeMachineId: machineId,
        imageRef: image,
      });
      await waitForAppVerification({
        origin: `https://${appName}.fly.dev`,
        verification: plan.verification ?? { path: "/", expectedStatus: 200 },
      });
    }
  } catch (error) {
    if (gatewayId) await destroyMachine(appName, gatewayId, flyToken);
    await destroyMachine(runtimeName, machineId, flyToken);
    if (storage.length && oldRuntime?.config?.image) {
      try {
        const restored = await createPreviewMachine(
          {
            appName: runtimeName,
            region: oldRuntime.region ?? process.env.FLY_REGION ?? "fra",
            image: oldRuntime.config.image,
            ...(oldRuntime.config?.init?.cmd
              ? { cmd: oldRuntime.config.init.cmd }
              : {}),
            internalPort:
              oldRuntime.config?.services?.[0]?.internal_port ??
              plan.port ??
              3000,
            additionalPorts: plan.apiPort ? [plan.apiPort] : undefined,
            publicServices: true,
            mounts: storage.map((volume) => ({
              volumeId: volume.volumeId,
              path: volume.mountPath,
            })),
            processGroup: "app",
          },
          flyToken,
        );
        await startMachine(runtimeName, restored, flyToken);
        await waitForMachineStarted(runtimeName, restored, flyToken);
        if (exposure === "private") {
          const restoredGateway = await createPreviewMachine(
            {
              appName,
              region: oldGateway?.region ?? process.env.FLY_REGION ?? "fra",
              image: oldGateway?.config?.image ?? gatewayImage!,
              internalPort: 8080,
              processGroup: "gateway",
              env: {
                KODY_APP_EXPOSURE: "private",
                KODY_APP_TOKEN_HASHES:
                  oldGateway?.config?.env?.KODY_APP_TOKEN_HASHES ?? tokenHashes,
                ...(flyHubPasswordHash
                  ? {
                      FLY_HUB_PASSWORD_HASH:
                        oldGateway?.config?.env?.FLY_HUB_PASSWORD_HASH ??
                        flyHubPasswordHash,
                      FLY_HUB_NAME: flyHubName,
                      FLY_HUB_SOURCE_REPO: repo,
                      FLY_HUB_COMMIT_SHA: ref,
                      ...(flyHubAppPasswordEnv
                        ? { FLY_HUB_APP_PASSWORD_ENV: flyHubAppPasswordEnv }
                        : {}),
                    }
                  : {}),
                KODY_APP_REPOSITORY: process.env.KODY_APP_REPOSITORY ?? "",
                KODY_APP_ID: process.env.KODY_APP_ID ?? "",
                KODY_APP_LAUNCH_VERIFY_KEY:
                  process.env.KODY_APP_LAUNCH_VERIFY_KEY ?? "",
                APP_TARGET_HOST: `${runtimeName}.flycast`,
                APP_INTERNAL_PORT: "80",
                ...(plan.apiPort
                  ? { APP_API_INTERNAL_PORT: String(plan.apiPort) }
                  : {}),
              },
            },
            flyToken,
          );
          await startMachine(appName, restoredGateway, flyToken);
          await waitForMachineStarted(appName, restoredGateway, flyToken);
        } else await uncordonMachine(appName, restored, flyToken);
      } catch (restoreError) {
        console.error("[app-builder] stateful rollback failed", restoreError);
      }
    }
    throw error;
  }
  if (!storage.length)
    for (const prior of oldRuntimeMachines) {
      await cordonMachine(runtimeName, prior.id, flyToken);
      await stopMachine(runtimeName, prior.id, flyToken);
      await destroyMachine(runtimeName, prior.id, flyToken);
    }
  if (!storage.length)
    for (const prior of oldGatewayMachines) {
      await cordonMachine(appName, prior.id, flyToken);
      await stopMachine(appName, prior.id, flyToken);
      await destroyMachine(appName, prior.id, flyToken);
    }
  await notify("running", {
    runtimeMachineId: machineId,
    gatewayMachineId: gatewayId,
    imageRef: image,
  });
}
main().catch(async (error) => {
  console.error("[app-builder] failed", error);
  try {
    const app = process.env.FLY_APP_NAME;
    const machine = process.env.FLY_MACHINE_ID;
    const token = process.env.FLY_API_TOKEN;
    if (app && machine && token) {
      let detail =
        `${error instanceof Error ? error.message : String(error)}\n${recentOutput}`.slice(
          -8_000,
        );
      let secrets: Record<string, string> = {};
      try {
        secrets = JSON.parse(
          process.env.APP_RUNTIME_SECRETS_JSON ?? "{}",
        ) as Record<string, string>;
      } catch {
        /* no secret list */
      }
      for (const value of [
        token,
        process.env.GITHUB_TOKEN,
        ...Object.values(secrets),
      ])
        if (value && value.length >= 8)
          detail = detail.replaceAll(value, "[redacted]");
      await fetch(
        `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(machine)}/metadata/flyhub_last_error`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: detail }),
          signal: AbortSignal.timeout(5_000),
        },
      );
    }
  } catch (metadataError) {
    console.error("[app-builder] could not save failure detail", metadataError);
  }
  await notify("failed", {
    errorCode:
      error instanceof Error &&
      (error.message.startsWith("APP_HEALTH_CHECK_FAILED") ||
        error.message.startsWith("APP_VERIFICATION_"))
        ? "verification_failed"
        : "deployment_failed",
  });
  process.exit(4);
});
