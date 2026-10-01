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
  destroyVolume,
  startMachine,
  stopMachine,
  uncordonMachine,
  waitForMachineStarted,
  waitForMachineStopped,
} from "./fly-api.ts";
import { replaceAppDeployment } from "./app-deployment-transaction.ts";
import { appDeployConfig } from "./app-deploy-config.ts";
import { runtimeAppName } from "./app-builder-names.ts";
import { clearAppBuilderCredentials } from "./app-builder-cleanup.ts";
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
const previousSecretValues: string[] = [];
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
  options: {
    cwd?: string;
    env?: Record<string, string>;
    sensitive?: boolean;
  } = {},
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
      if (!options.sensitive) rememberOutput(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!options.sensitive) {
        rememberOutput(chunk.toString());
        process.stderr.write(chunk);
      }
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
  const alwaysOn = process.env.APP_ALWAYS_ON === "1";
  const exposure =
    process.env.KODY_APP_EXPOSURE === "public" ? "public" : "private";
  const runtimeName =
    exposure === "private" ? runtimeAppName(appName) : appName;
  const tokenHashes = process.env.KODY_APP_TOKEN_HASHES ?? "";
  const flyHubPasswordHash = process.env.FLY_HUB_PASSWORD_HASH ?? "";
  const flyHubPasswordEncrypted = process.env.FLY_HUB_PASSWORD_ENCRYPTED ?? "";
  const flyHubName = process.env.FLY_HUB_NAME ?? "";
  const flyHubAppPasswordEnv = process.env.FLY_HUB_APP_PASSWORD_ENV ?? "";
  const flyHubAppPasswordEncrypted =
    process.env.FLY_HUB_APP_PASSWORD_ENCRYPTED ?? "";
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
  const oldRuntimeMachines = await listMachines(runtimeName, flyToken);
  const oldGatewayMachines =
    exposure === "private" ? await listMachines(appName, flyToken) : [];
  const previousVolumeIds = new Set(
    oldRuntimeMachines.flatMap(
      (machine) => machine.config?.mounts?.map((mount) => mount.volume) ?? [],
    ),
  );
  if (plan.storagePath && !storage.length) {
    const env = { FLY_API_TOKEN: flyToken };
    const existing = JSON.parse(
      await runOutput(
        "flyctl",
        ["volumes", "list", "--app", runtimeName, "--json"],
        { env },
      ),
    ) as Array<{ id?: string; name?: string }>;
    let volumeId = existing.find(
      (volume) => volume.id && previousVolumeIds.has(volume.id),
    )?.id;
    if (!oldRuntimeMachines.length)
      volumeId ??= existing.find((volume) => volume.name === "flyhub_data")?.id;
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
  // Only read declared app secrets, and never send secret-bearing output to logs.
  const previousSecrets: Record<string, string> = {};
  const addedSecretNames: string[] = [];
  if (oldRuntimeMachines.length && Object.keys(secrets).length) {
    const secretNames = JSON.parse(
      await runOutput(
        "flyctl",
        ["secrets", "list", "--app", runtimeName, "--json"],
        { env: { FLY_API_TOKEN: flyToken }, sensitive: true },
      ),
    ) as Array<{ Name?: string; name?: string }>;
    const names = new Set(secretNames.map((item) => item.Name ?? item.name));
    const changedExisting = Object.keys(secrets).filter((name) =>
      names.has(name),
    );
    addedSecretNames.push(
      ...Object.keys(secrets).filter((name) => !names.has(name)),
    );
    if (changedExisting.length) {
      const source =
        oldRuntimeMachines.find((machine) => machine.state === "started") ??
        oldRuntimeMachines[0]!;
      if (source.state !== "started") {
        await startMachine(runtimeName, source.id, flyToken);
        await waitForMachineStarted(runtimeName, source.id, flyToken);
      }
      const output = await runOutput(
        "flyctl",
        [
          "ssh",
          "console",
          "--app",
          runtimeName,
          "--machine",
          source.id,
          "--command",
          "env -0",
        ],
        { env: { FLY_API_TOKEN: flyToken }, sensitive: true },
      );
      const environment = new Map(
        output
          .split("\0")
          .filter((line) => line.includes("="))
          .map((line) => [
            line.slice(0, line.indexOf("=")),
            line.slice(line.indexOf("=") + 1),
          ]),
      );
      for (const name of changedExisting) {
        const value = environment.get(name);
        if (value === undefined)
          throw new Error(
            `Cannot safely update: previous value of secret ${name} could not be read. Existing deployment was left intact.`,
          );
        previousSecrets[name] = value;
        previousSecretValues.push(value);
      }
    }
  }
  const importSecrets = async (values: Record<string, string>) => {
    if (!Object.keys(values).length) return;
    await run(
      "flyctl",
      ["secrets", "import", "--stage", "--app", runtimeName],
      {
        input:
          Object.entries(values)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n",
        env: { FLY_API_TOKEN: flyToken },
      },
    );
  };
  let machineId: string | undefined;
  let gatewayId: string | undefined;
  await replaceAppDeployment({
    previous: [
      ...oldGatewayMachines.map((machine) => ({ app: appName, ...machine })),
      ...oldRuntimeMachines.map((machine) => ({
        app: runtimeName,
        ...machine,
      })),
    ],
    storage,
    previousVolumeIds,
    actions: {
      cordon: (machine) => cordonMachine(machine.app, machine.id, flyToken),
      stop: async (machine) => {
        if (machine.state === "stopped") return;
        await stopMachine(machine.app, machine.id, flyToken);
        await waitForMachineStopped(machine.app, machine.id, flyToken);
      },
      resume: async (machine) => {
        await startMachine(machine.app, machine.id, flyToken);
        await waitForMachineStarted(machine.app, machine.id, flyToken);
        await uncordonMachine(machine.app, machine.id, flyToken);
      },
      destroy: (machine) => destroyMachine(machine.app, machine.id, flyToken),
      fork: async (volume) => {
        const copied = JSON.parse(
          await runOutput(
            "flyctl",
            [
              "volumes",
              "fork",
              volume.volumeId,
              "--app",
              runtimeName,
              "--name",
              "flyhub_data",
              "--json",
            ],
            { env: { FLY_API_TOKEN: flyToken } },
          ),
        ) as { id?: string } | Array<{ id?: string }>;
        const volumeId = Array.isArray(copied) ? copied[0]?.id : copied.id;
        if (!volumeId)
          throw new Error(
            "Could not copy the app's data volume. Previous data remains intact.",
          );
        return { ...volume, volumeId };
      },
      destroyVolume: (volume) =>
        destroyVolume(runtimeName, volume.volumeId, flyToken),
      applySecrets: () => importSecrets(secrets),
      restoreSecrets: async () => {
        if (addedSecretNames.length)
          await run(
            "flyctl",
            [
              "secrets",
              "unset",
              "--stage",
              "--app",
              runtimeName,
              ...addedSecretNames,
            ],
            { env: { FLY_API_TOKEN: flyToken } },
          );
        await importSecrets(previousSecrets);
      },
      verifyRecovery: () =>
        waitApplicationHealthy(
          `https://${appName}.fly.dev${exposure === "private" ? "/_kody/health" : "/"}`,
        ),
      report: (message) => {
        console.log(`[app-builder] ${message}`);
        rememberOutput(message + "\n");
      },
      deploy: async (candidateStorage, register) => {
        try {
          machineId = await createPreviewMachine(
            {
              appName: runtimeName,
              region: process.env.FLY_REGION ?? "fra",
              image,
              ...(plan.startCommand &&
              (plan.kind === "dockerfile" || plan.kind === "fly")
                ? { cmd: ["sh", "-c", plan.startCommand] }
                : {}),
              internalPort: plan.port ?? 3000,
              additionalPorts: plan.apiPort ? [plan.apiPort] : undefined,
              publicServices: true,
              healthCheck: true,
              mounts: candidateStorage.map((volume) => ({
                volumeId: volume.volumeId,
                path: volume.mountPath,
              })),
              env: runtimeEnv,
              processGroup: "app",
              idleSuspend: !alwaysOn,
            },
            flyToken,
          );
          register({ app: runtimeName, id: machineId, state: "created" });
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
                idleSuspend: !alwaysOn,
                env: {
                  KODY_APP_EXPOSURE: exposure,
                  KODY_APP_TOKEN_HASHES: tokenHashes,
                  ...(flyHubPasswordHash
                    ? {
                        FLY_HUB_PASSWORD_HASH: flyHubPasswordHash,
                        ...(flyHubPasswordEncrypted
                          ? {
                              FLY_HUB_PASSWORD_ENCRYPTED:
                                flyHubPasswordEncrypted,
                            }
                          : {}),
                        FLY_HUB_NAME: flyHubName,
                        FLY_HUB_ALWAYS_ON: alwaysOn ? "1" : "0",
                        FLY_HUB_SOURCE_REPO: repo,
                        FLY_HUB_COMMIT_SHA: ref,
                        ...(flyHubAppPasswordEnv
                          ? { FLY_HUB_APP_PASSWORD_ENV: flyHubAppPasswordEnv }
                          : {}),
                        ...(flyHubAppPasswordEncrypted
                          ? {
                              FLY_HUB_APP_PASSWORD_ENCRYPTED:
                                flyHubAppPasswordEncrypted,
                            }
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
            register({ app: appName, id: gatewayId, state: "created" });
            await startMachine(appName, gatewayId, flyToken);
            await waitForMachineStarted(appName, gatewayId, flyToken);
            await uncordonMachine(appName, gatewayId, flyToken);
            await waitApplicationHealthy(
              `https://${appName}.fly.dev/_kody/health`,
            );
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
              verification: plan.verification ?? {
                path: "/",
                expectedStatus: 200,
              },
              privateAccess: {
                repository: required("KODY_APP_REPOSITORY"),
                appId: required("KODY_APP_ID"),
                verifyKey: Buffer.from(
                  required("KODY_APP_LAUNCH_VERIFY_KEY"),
                  "hex",
                ),
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
              verification: plan.verification ?? {
                path: "/",
                expectedStatus: 200,
              },
            });
          }
        } catch (error) {
          if (machineId) {
            try {
              await runOutput(
                "flyctl",
                [
                  "logs",
                  "--no-tail",
                  "--app",
                  runtimeName,
                  "--machine",
                  machineId,
                ],
                { env: { FLY_API_TOKEN: flyToken } },
              );
            } catch {
              console.error("[app-builder] could not collect runtime logs");
            }
          }
          throw error;
        }
      },
    },
  });
  await notify("running", {
    runtimeMachineId: machineId,
    gatewayMachineId: gatewayId,
    imageRef: image,
  });
}
let buildStatus: "completed" | "failed" = "completed";
main()
  .catch(async (error) => {
    buildStatus = "failed";
    console.error("[app-builder] failed", error);
    try {
      const app = process.env.FLY_APP_NAME;
      const machine = process.env.FLY_MACHINE_ID;
      const token = process.env.FLY_API_TOKEN;
      if (app && machine && token) {
        let detail =
          `${recentOutput.slice(-7_500)}\n${error instanceof Error ? error.message : String(error)}`.slice(
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
          ...previousSecretValues,
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
      console.error(
        "[app-builder] could not save failure detail",
        metadataError,
      );
    }
    await notify("failed", {
      errorCode:
        error instanceof Error &&
        (error.message.startsWith("APP_HEALTH_CHECK_FAILED") ||
          error.message.startsWith("APP_VERIFICATION_"))
          ? "verification_failed"
          : "deployment_failed",
    });
    process.exitCode = 4;
  })
  .finally(async () => {
    const app = process.env.FLY_APP_NAME;
    const machine = process.env.FLY_MACHINE_ID;
    const token = process.env.FLY_API_TOKEN;
    if (!app || !machine || !token) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await clearAppBuilderCredentials({
          app,
          machine,
          token,
          status: buildStatus,
        });
        return;
      } catch {
        console.error("[app-builder] credential cleanup failed; retrying");
      }
    }
    console.error(
      "[app-builder] credentials could not be cleared; opening run status will retry cleanup",
    );
  });
