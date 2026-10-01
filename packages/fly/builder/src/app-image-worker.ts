import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  encryptArchive,
  decryptArchive,
  fileDigest,
  machineExportScript,
  savedImageRef,
  savedAppVersion,
  savedAppPackage,
  shellQuote,
  appNamePattern,
  registryImageReference,
} from "./app-image-format.ts";
import {
  assertPrivatePackage,
  registryBearer,
  registryManifest,
} from "./app-image-registry.ts";
import {
  createApp,
  allocatePrivateIp,
  allocateSharedIps,
  waitForMachineStarted,
} from "./fly-api.ts";
import { runtimeAppName } from "./app-builder-names.ts";
import { startRestoredMachine } from "./app-image-startup.ts";

type Config = Record<string, any>;
type Machine = { id: string; state: string; region: string; config: Config };
type Volume = { path: string; sizeGb: number; archive: string };
type SavedMachine = {
  role: "runtime" | "gateway";
  config: Config;
  imageConfig: Config;
  archive: string;
  volumes: Volume[];
  secrets: Record<string, string>;
};
type Snapshot = {
  version: 1;
  sourceApp: string;
  name: string;
  createdAt: string;
  machines: SavedMachine[];
};
type Job = {
  action: "save" | "create";
  id: string;
  user: string;
  sourceApp?: string;
  appName?: string;
  name: string;
  region: string;
  passwordHash?: string;
  passwordEncrypted?: string;
};
const job = JSON.parse(process.env.APP_IMAGE_JOB!) as Job;
const flyToken = process.env.FLY_API_TOKEN!;
const githubToken = process.env.GHCR_TOKEN!;
const key = Buffer.from(process.env.APP_IMAGE_KEY!, "hex");
const host = process.env.FLY_APP_NAME!;
const self = process.env.FLY_MACHINE_ID!;
let work = "",
  authfile = "";
let phase = "starting";
let exportLoader = "";
const hiddenValues = new Set(
  [
    flyToken,
    githubToken,
    key.toString("hex"),
    job.passwordHash,
    job.passwordEncrypted,
  ].filter((value): value is string => !!value),
);
function safeDiagnostic(text: string) {
  let safe = text.replace(/\u001b\[[0-9;]*m/g, "");
  for (const value of hiddenValues)
    if (value.length >= 6) safe = safe.replaceAll(value, "[redacted]");
  return safe
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|(?:fm1r|fm1a|fm2)_[A-Za-z0-9_-]+)\b/g,
      "[redacted]",
    )
    .trim()
    .slice(-1500);
}
const endpoint = "https://api.machines.dev/v1";
const machineLeases = new Map<string, string>();

async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${flyToken}`,
      "content-type": "application/json",
      ...Object.fromEntries(
        [...machineLeases]
          .filter(
            ([machine]) => path === machine || path.startsWith(`${machine}/`),
          )
          .map(([, nonce]) => ["fly-machine-lease-nonce", nonce]),
      ),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(
      method === "POST" && path.endsWith("/machines") ? 180_000 : 30_000,
    ),
  });
  if (!response.ok)
    throw new Error(
      `Fly ${method} ${path.replace(/\/machines\/[^/]+/, "/machines/[id]")} failed (HTTP ${response.status}).`,
    );
  return response.status === 204
    ? null
    : response.text().then((t) => (t ? JSON.parse(t) : null));
}
async function withMachineLease<T>(
  app: string,
  id: string,
  copy: () => Promise<T>,
): Promise<T> {
  const path = `/apps/${app}/machines/${id}`;
  let acquired: Config;
  try {
    acquired = await api(`${path}/lease`, "POST", {
      ttl: 60,
      description: "FlyHub saving app files",
    });
  } catch (error) {
    throw new Error(
      `Could not lock the app for saving. Another operation may be running. ${error instanceof Error ? error.message : "Retry saving."}`,
    );
  }
  const nonce = acquired.data?.nonce;
  if (typeof nonce !== "string")
    throw new Error("Fly did not provide a snapshot lease.");
  machineLeases.set(path, nonce);
  let pending: Promise<void> | null = null;
  let leaseLost = false;
  const timer = setInterval(() => {
    if (pending) return;
    pending = api(`${path}/lease`, "POST", { ttl: 60 })
      .then(() => undefined)
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        pending = null;
      });
  }, 15_000);
  try {
    const value = await copy();
    if (pending) await pending;
    if (leaseLost)
      throw new Error(
        "The machine lock could not be maintained. The app resumed, but its backup was not published. Retry saving.",
      );
    return value;
  } finally {
    clearInterval(timer);
    if (pending) await pending;
    await api(`${path}/lease`, "DELETE").catch(() => undefined);
    machineLeases.delete(path);
  }
}
async function progress(value: string, status = "working", error = "") {
  phase = value;
  console.log(`[saved-app] ${value}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(
      `${endpoint}/apps/${host}/machines/${self}/metadata`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${flyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          metadata: {
            flyhub_image_status: status,
            flyhub_image_phase: value,
            flyhub_image_error: error || null,
            flyhub_image_updated: new Date().toISOString(),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) return;
    if (res.status !== 429 && res.status < 500)
      throw new Error(
        `Could not record saved app progress (HTTP ${res.status}).`,
      );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000 * 2 ** attempt, 16000)),
    );
  }
  throw new Error(
    "Could not record saved app progress after retrying Fly's API.",
  );
}
function run(
  command: string,
  args: string[],
  input?: string,
  timeout = 15 * 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (b) => {
      stdout = (stdout + b).slice(-2_000_000);
    });
    child.stderr?.on("data", (b) => {
      stderr = (stderr + b).slice(-8000);
    });
    if (input) child.stdin?.end(input);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out during ${phase}.`));
    }, timeout);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Stdout can contain app credentials; only retain redacted diagnostic stderr.
      if (code === 0) resolve(stdout);
      else {
        const detail = safeDiagnostic(stderr);
        if (detail) console.error(`[saved-app] ${command}: ${detail}`);
        reject(
          new Error(
            `${command} failed during ${phase} (exit ${code}). ${/no space left/i.test(stderr) ? "Not enough temporary disk space." : /unauthorized|denied/i.test(stderr) ? "Registry or machine access was denied." : detail || "The command returned no diagnostic output."}`,
          ),
        );
      }
    });
  });
}
async function registryLogin() {
  const tokens = flyToken
    .trim()
    .replace(/^(FlyV1|Bearer)\s+/i, "")
    .split(",")
    .map((t) => t.trim());
  const macaroons = tokens.filter((t) => /^(fm1r|fm1a|fm2)_/.test(t));
  authfile = `${work}/registry-auth.json`;
  await writeFile(
    authfile,
    JSON.stringify({
      auths: {
        "ghcr.io": {
          auth: Buffer.from(`${job.user}:${githubToken}`).toString("base64"),
        },
        "registry.fly.io": {
          auth: Buffer.from(
            `x:${(macaroons.length ? macaroons : tokens).join(",")}`,
          ).toString("base64"),
        },
      },
    }),
    { mode: 0o600 },
  );
}
async function prepareExporter() {
  const tarPath = (await run("sh", ["-c", "command -v tar"])).trim();
  const libraries = [
    ...(await run("ldd", [tarPath])).matchAll(/\/[^\s()]+/g),
  ].map((match) => match[0]);
  const tools = `${work}/export-tools/tools`;
  await mkdir(tools, { recursive: true });
  await cp(tarPath, `${tools}/tar`, { dereference: true });
  for (const library of new Set(libraries)) {
    const name = library.split("/").at(-1)!;
    await cp(library, `${tools}/${name}`, { dereference: true });
    if (name.startsWith("ld-musl-")) exportLoader = name;
  }
  if (!exportLoader)
    throw new Error(
      "The builder is missing the portable filesystem export tool.",
    );
  await run("tar", [
    "-C",
    `${work}/export-tools`,
    "-czf",
    `${work}/export-tools.tgz`,
    "tools",
  ]);
}
async function copyImage(source: string, target: string) {
  await run("skopeo", [
    "copy",
    "--authfile",
    authfile,
    "--format",
    "oci",
    source,
    target,
  ]);
}
async function uncompressedDigest(archive: string) {
  const hash = crypto.createHash("sha256");
  await pipeline(
    createReadStream(archive),
    createGunzip(),
    new Writable({
      write(chunk, _encoding, done) {
        hash.update(chunk);
        done();
      },
    }),
  );
  return `sha256:${hash.digest("hex")}`;
}
async function writeOci(
  directory: string,
  archive: string,
  imageConfig: Config,
  annotations: Record<string, string> = {},
) {
  const blobs = `${directory}/blobs/sha256`;
  await mkdir(blobs, { recursive: true });
  const layerDigest = await fileDigest(archive);
  await link(archive, `${blobs}/${layerDigest.slice(7)}`);
  const config = {
    ...imageConfig,
    rootfs: { type: "layers", diff_ids: [await uncompressedDigest(archive)] },
    history: [
      { created: new Date().toISOString(), created_by: "FlyHub saved app" },
    ],
  };
  const putJson = async (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    await writeFile(`${blobs}/${digest.slice(7)}`, bytes, { mode: 0o600 });
    return { digest, size: bytes.length };
  };
  const configBlob = await putJson(config);
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      ...configBlob,
    },
    layers: [
      {
        mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        digest: layerDigest,
        size: (await stat(archive)).size,
      },
    ],
    annotations,
  };
  const manifestBlob = await putJson(manifest);
  await writeFile(`${directory}/oci-layout`, '{"imageLayoutVersion":"1.0.0"}');
  await writeFile(
    `${directory}/index.json`,
    JSON.stringify({
      schemaVersion: 2,
      manifests: [{ mediaType: manifest.mediaType, ...manifestBlob }],
    }),
  );
}
async function saveMachine(
  app: string,
  machine: Machine,
  role: SavedMachine["role"],
  packageDir: string,
): Promise<SavedMachine> {
  await progress(`preparing-${role}`);
  return withMachineLease(app, machine.id, async () => {
    const current = await api(`/apps/${app}/machines/${machine.id}`);
    if (!["started", "starting"].includes(current.state))
      await api(`/apps/${app}/machines/${machine.id}/start`, "POST");
    await waitForMachineStarted(app, machine.id, flyToken);
    return saveMachineFiles(
      app,
      { ...machine, config: current.config },
      role,
      packageDir,
    );
  });
}
async function saveMachineFiles(
  app: string,
  machine: Machine,
  role: SavedMachine["role"],
  packageDir: string,
): Promise<SavedMachine> {
  const imageConfig = JSON.parse(
    await run("skopeo", [
      "inspect",
      "--config",
      "--authfile",
      authfile,
      `docker://${registryImageReference(machine.config.image)}`,
    ]),
  );
  for (const value of Object.values(machine.config.env ?? {}))
    if (typeof value === "string") hiddenValues.add(value);
  const mountConfig = (machine.config.mounts ?? []) as Array<{
    volume: string;
    path: string;
  }>;
  const volumes: Volume[] = [];
  for (let i = 0; i < mountConfig.length; i++) {
    const mount = mountConfig[i]!;
    const volume = await api(`/apps/${app}/volumes/${mount.volume}`);
    volumes.push({
      path: mount.path,
      sizeGb: volume.size_gb,
      archive: `${role}-volume-${i}.enc`,
    });
  }
  // Capture declared Fly secrets only, without platform or worker credentials.
  const secretList = JSON.parse(
    await run("flyctl", ["secrets", "list", "--app", app, "--json"]),
  ) as Array<{ Name?: string; name?: string }>;
  const secrets: Record<string, string> = {};
  if (secretList.length) {
    // Machines /exec acquires its own lease and rejects an existing snapshot
    // lease. SSH reads the same app environment without releasing the lock.
    const environment = await run("flyctl", [
      "ssh",
      "console",
      "--app",
      app,
      "--machine",
      machine.id,
      "--command",
      "env -0",
    ]);
    const env = Object.fromEntries(
      environment
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    );
    for (const secret of secretList) {
      const name = secret.Name ?? secret.name!;
      if (!Object.hasOwn(env, name))
        throw new Error(
          `Runtime credential ${name} was not available to save.`,
        );
      secrets[name] = env[name]!;
      hiddenValues.add(env[name]!);
    }
  }
  const remote = `/tmp/flyhub-export-${job.id}`;
  const script = `${work}/${role}-export.sh`;
  await writeFile(
    script,
    machineExportScript(
      remote,
      volumes.map((v) => v.path),
      exportLoader,
    ),
    { mode: 0o700 },
  );
  await progress(`copying-${role}-files`);
  // SSH traffic does not count as service activity; keep Fly's idle suspend off
  // while exporting/downloading, without restarting or changing the source machine.
  const keepAwake = () =>
    fetch(
      role === "gateway"
        ? `https://${app}.fly.dev/_kody/health`
        : `http://${app}.flycast/`,
      { signal: AbortSignal.timeout(12_000) },
    )
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  void keepAwake();
  const heartbeat = setInterval(() => void keepAwake(), 15_000);
  try {
    await run("flyctl", [
      "ssh",
      "sftp",
      "put",
      `${work}/export-tools.tgz`,
      `${remote}.tools.tgz`,
      "--mode",
      "0600",
      "--app",
      app,
      "--machine",
      machine.id,
      "--quiet",
    ]);
    await run("flyctl", [
      "ssh",
      "sftp",
      "put",
      script,
      `${remote}.sh`,
      "--mode",
      "0700",
      "--app",
      app,
      "--machine",
      machine.id,
      "--quiet",
    ]);
    await run("flyctl", [
      "ssh",
      "console",
      "--app",
      app,
      "--machine",
      machine.id,
      "--command",
      `/bin/sh ${remote}.sh`,
    ]);
    for (const [filename, destination] of [
      ["root.tgz", `${role}-root.enc`],
      ...volumes.map((v, i) => [`volume-${i}.tgz`, v.archive]),
    ] as Array<[string, string]>) {
      const local = `${work}/${role}-${filename}`;
      await run("flyctl", [
        "sftp",
        "get",
        `${remote}/${filename}`,
        local,
        "--app",
        app,
        "--machine",
        machine.id,
        "--quiet",
      ]);
      await encryptArchive(local, `${packageDir}/${destination}`, key);
      await rm(local);
    }
  } finally {
    clearInterval(heartbeat);
    await run(
      "flyctl",
      [
        "ssh",
        "console",
        "--app",
        app,
        "--machine",
        machine.id,
        "--command",
        `/bin/sh -c ${shellQuote(`rm -rf ${remote} ${remote}.sh ${remote}.tools.tgz`)}`,
      ],
      undefined,
      30_000,
    ).catch(() => undefined);
  }
  return {
    role,
    config: machine.config,
    imageConfig,
    archive: `${role}-root.enc`,
    volumes,
    secrets,
  };
}
async function save() {
  const app = job.sourceApp!;
  if (!appNamePattern.test(app)) throw new Error("Invalid source app.");
  await assertPrivatePackage(job.user, githubToken, true);
  const gateways = (await api(`/apps/${app}/machines`)) as Machine[];
  const gateway = gateways.find((m) => m.config.env?.FLY_HUB_PASSWORD_HASH);
  const runtime = (await api(
    `/apps/${runtimeAppName(app)}/machines`,
  )) as Machine[];
  if (!gateway || runtime.length !== 1)
    throw new Error("Save requires one app runtime and its password gateway.");
  const packageDir = `${work}/package/backup`;
  await mkdir(packageDir, { recursive: true });
  const machines = [
    await saveMachine(app, gateway, "gateway", packageDir),
    await saveMachine(runtimeAppName(app), runtime[0]!, "runtime", packageDir),
  ];
  const snapshot: Snapshot = {
    version: 1,
    sourceApp: app,
    name: job.name,
    createdAt: new Date().toISOString(),
    machines,
  };
  await writeFile(`${work}/metadata.json`, JSON.stringify(snapshot), {
    mode: 0o600,
  });
  await encryptArchive(
    `${work}/metadata.json`,
    `${packageDir}/metadata.enc`,
    key,
  );
  await rm(`${work}/metadata.json`);
  await progress("uploading-to-ghcr");
  await run("tar", [
    "-C",
    `${work}/package`,
    "-cf",
    `${work}/package.tar`,
    "backup",
  ]);
  // Ciphertext cannot compress. Store it in a gzip envelope without trying to
  // deflate it, preserving the standard OCI layer format and saving CPU/time.
  await pipeline(
    createReadStream(`${work}/package.tar`),
    createGzip({ level: 0 }),
    createWriteStream(`${work}/package.tgz`, { mode: 0o600 }),
  );
  await rm(`${work}/package.tar`);
  await writeOci(
    `${work}/oci`,
    `${work}/package.tgz`,
    { architecture: "amd64", os: "linux", config: {} },
    {
      "app.flyhub.version": savedAppVersion,
      "app.flyhub.source": app,
      "org.opencontainers.image.title": snapshot.name,
      "org.opencontainers.image.created": snapshot.createdAt,
    },
  );
  const ref = savedImageRef(job.user, job.id);
  await copyImage(`oci:${work}/oci`, `docker://${ref}`);
  // New packages can take a few seconds to appear in the GitHub API after upload.
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await assertPrivatePackage(job.user, githubToken, true)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await assertPrivatePackage(job.user, githubToken, false);
  const bearer = await registryBearer(job.user, githubToken);
  const manifest = await registryManifest(job.user, bearer, `app-${job.id}`);
  if (manifest.annotations?.["app.flyhub.source"] !== app)
    throw new Error("Saved image verification failed.");
  await progress("saved", "completed");
}
async function unpackSnapshot(): Promise<Snapshot> {
  await progress("downloading-saved-app");
  await assertPrivatePackage(job.user, githubToken, false);
  await copyImage(
    `docker://${savedImageRef(job.user, job.id)}`,
    `oci:${work}/download`,
  );
  const index = JSON.parse(
    await readFile(`${work}/download/index.json`, "utf8"),
  );
  const blob = (digest: string) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new Error("Invalid snapshot digest.");
    return `${work}/download/blobs/sha256/${digest.slice(7)}`;
  };
  const manifest = JSON.parse(
    await readFile(blob(index.manifests[0].digest), "utf8"),
  );
  if (
    manifest.annotations?.["app.flyhub.version"] !== savedAppVersion ||
    manifest.layers.length !== 1
  )
    throw new Error("Unsupported saved app format.");
  // Only regular, known encrypted files are allowed in the snapshot package.
  const entries = (await run("tar", ["-tzf", blob(manifest.layers[0].digest)]))
    .trim()
    .split("\n");
  if (
    entries.some(
      (p) =>
        !/^backup\/(?:metadata\.enc|(?:runtime|gateway)-(?:root|volume-\d+)\.enc)?$/.test(
          p,
        ),
    )
  )
    throw new Error("Invalid saved app package contents.");
  const types = (await run("tar", ["-tvzf", blob(manifest.layers[0].digest)]))
    .trim()
    .split("\n");
  if (types.some((line) => !["-", "d"].includes(line[0]!)))
    throw new Error("Saved app package contains unsupported file types.");
  await mkdir(`${work}/unpacked`);
  await run("tar", [
    "-xzf",
    blob(manifest.layers[0].digest),
    "-C",
    `${work}/unpacked`,
  ]);
  await decryptArchive(
    `${work}/unpacked/backup/metadata.enc`,
    `${work}/metadata.json`,
    key,
  );
  const snapshot = JSON.parse(
    await readFile(`${work}/metadata.json`, "utf8"),
  ) as Snapshot;
  if (
    snapshot.version !== 1 ||
    !appNamePattern.test(snapshot.sourceApp) ||
    snapshot.machines.length !== 2 ||
    snapshot.machines.filter((m) => m.role === "runtime").length !== 1 ||
    snapshot.machines.filter((m) => m.role === "gateway").length !== 1
  )
    throw new Error("Invalid saved machine metadata.");
  return snapshot;
}
async function waitHealthy(app: string) {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`https://${app}.fly.dev/_kody/health`, {
      signal: AbortSignal.timeout(4000),
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error("Restored app did not pass its startup health check.");
}
async function create() {
  const snapshot = await unpackSnapshot();
  const app = job.appName!;
  const runtime = runtimeAppName(app);
  if (!appNamePattern.test(app)) throw new Error("Invalid destination app.");
  const createdApps: string[] = [];
  try {
    for (const name of [app, runtime]) {
      const exists = await fetch(`${endpoint}/apps/${name}`, {
        headers: { authorization: `Bearer ${flyToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (exists.status !== 404)
        throw new Error("Destination app already exists or cannot be checked.");
      await createApp(name, process.env.FLY_ORG_SLUG!, flyToken);
      createdApps.push(name);
    }
    await allocateSharedIps(app, flyToken);
    await allocatePrivateIp(runtime, flyToken);
    for (const saved of [...snapshot.machines].sort((a, b) =>
      a.role === "runtime" ? -1 : b.role === "runtime" ? 1 : 0,
    )) {
      for (const value of [
        ...Object.values(saved.secrets),
        ...Object.values(saved.config.env ?? {}),
      ])
        if (typeof value === "string") hiddenValues.add(value);
      const name = saved.role === "runtime" ? runtime : app;
      await progress(`restoring-${saved.role}-files`);
      const root = `${work}/${saved.role}-root.tgz`;
      await decryptArchive(
        `${work}/unpacked/backup/${saved.archive}`,
        root,
        key,
      );
      await writeOci(`${work}/${saved.role}-image`, root, saved.imageConfig);
      const image = `registry.fly.io/${name}:saved-${job.id}`;
      await progress(`uploading-${saved.role}-image`);
      await copyImage(`oci:${work}/${saved.role}-image`, `docker://${image}`);
      const mounts: Array<{ volume: string; path: string }> = [];
      for (const [i, volume] of saved.volumes.entries()) {
        if (
          !volume.path.startsWith("/") ||
          volume.path.split("/").includes("..") ||
          !Number.isInteger(volume.sizeGb) ||
          volume.sizeGb < 1
        )
          throw new Error("Invalid saved volume.");
        const created = await api(`/apps/${name}/volumes`, "POST", {
          name: `flyhub_data_${i}`,
          region: job.region,
          size_gb: volume.sizeGb,
          encrypted: true,
          auto_backup_enabled: true,
        });
        mounts.push({ volume: created.id, path: volume.path });
      }
      const replace = (value: string) =>
        value
          .replaceAll(`${snapshot.sourceApp}.fly.dev`, `${app}.fly.dev`)
          .replaceAll(
            `${runtimeAppName(snapshot.sourceApp)}.flycast`,
            `${runtime}.flycast`,
          );
      const config: Config = {
        ...saved.config,
        image,
        mounts,
        env: Object.fromEntries(
          Object.entries(saved.config.env ?? {}).map(([k, v]) => [
            k,
            replace(String(v)),
          ]),
        ),
      };
      delete config.files; // Snapshot already contains the boot-injected files.
      if (saved.role === "gateway") {
        config.env = {
          ...config.env,
          FLY_HUB_NAME: job.name,
          FLY_HUB_PASSWORD_HASH: job.passwordHash,
          FLY_HUB_PASSWORD_ENCRYPTED: job.passwordEncrypted,
          FLY_HUB_SAVED_APP_ID: job.id,
          APP_TARGET_HOST: `${runtime}.flycast`,
        };
        delete config.env.KODY_APP_LAUNCH_VERIFY_KEY;
      }
      if (Object.keys(saved.secrets).length)
        await run(
          "flyctl",
          ["secrets", "import", "--stage", "--app", name],
          Object.entries(saved.secrets)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join("\n") + "\n",
        );
      let machine: { id: string };
      if (mounts.length) {
        // Seed the empty volumes before starting the app, so mounts cannot hide saved data.
        await progress(`starting-${saved.role}-volume-loader`);
        machine = await api(`/apps/${name}/machines`, "POST", {
          region: job.region,
          config: {
            image: process.env.APP_IMAGE_WORKER_IMAGE,
            init: { cmd: ["sleep", "900"] },
            mounts,
            restart: { policy: "no" },
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
          },
        });
        await startRestoredMachine(name, machine.id, flyToken);
        await progress(`restoring-${saved.role}-data`);
        for (const [i, volume] of saved.volumes.entries()) {
          const archive = `${work}/${saved.role}-data-${i}.tgz`;
          await decryptArchive(
            `${work}/unpacked/backup/${volume.archive}`,
            archive,
            key,
          );
          await run("flyctl", [
            "ssh",
            "sftp",
            "put",
            archive,
            `/tmp/flyhub-data-${i}.tgz`,
            "--mode",
            "0600",
            "--app",
            name,
            "--machine",
            machine.id,
            "--quiet",
          ]);
          await run("flyctl", [
            "ssh",
            "console",
            "--app",
            name,
            "--machine",
            machine.id,
            "--command",
            `/bin/sh -c ${shellQuote(`tar --xattrs --acls -xzf /tmp/flyhub-data-${i}.tgz -C ${shellQuote(volume.path)} && rm /tmp/flyhub-data-${i}.tgz`)}`,
          ]);
        }
        await progress(`starting-restored-${saved.role}`);
        await api(`/apps/${name}/machines/${machine.id}`, "POST", { config });
      } else {
        await progress(`starting-restored-${saved.role}`);
        machine = await api(`/apps/${name}/machines`, "POST", {
          region: job.region,
          config,
        });
      }
      await startRestoredMachine(name, machine.id, flyToken);
    }
    await progress("checking-restored-app");
    await waitHealthy(app);
    const gate = await fetch(`https://${app}.fly.dev`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (gate.status !== 401)
      throw new Error("Restored app is not protected by its password gateway.");
    await progress("created", "completed");
  } catch (error) {
    const failedPhase = phase;
    // Progress reporting must never prevent removing an incomplete app.
    await progress("cleaning-up-failed-create").catch(() => undefined);
    const failures: string[] = [];
    for (const name of createdApps.reverse()) {
      const response = await fetch(`${endpoint}/apps/${name}?force=true`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${flyToken}` },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (!response?.ok && response?.status !== 404) failures.push(name);
    }
    if (failures.length)
      throw new Error(
        `Create failed and cleanup could not remove: ${failures.join(", ")}. Remove these apps in Fly before retrying.`,
      );
    phase = failedPhase;
    throw error;
  }
}

try {
  work = await mkdtemp(`${tmpdir()}/flyhub-image-`);
  await registryLogin();
  await progress("starting");
  if (job.action === "save") {
    await prepareExporter();
    await save();
  } else if (job.action === "create") await create();
  else throw new Error("Invalid saved app operation.");
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Saved app operation failed.";
  console.error(`[saved-app] ${message}`);
  await progress(phase, "failed", message).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (work)
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  // Retain progress, remove job credentials from the stopped worker's configuration.
  const machine = await api(`/apps/${host}/machines/${self}`).catch(() => null);
  const finalMetadata = await api(
    `/apps/${host}/machines/${self}/metadata`,
  ).catch(() => null);
  if (machine?.config && finalMetadata)
    await api(`/apps/${host}/machines/${self}`, "POST", {
      config: {
        ...machine.config,
        metadata: finalMetadata,
        env: {},
        init: { cmd: ["sh", "-c", "exit 0"] },
      },
      skip_launch: true,
    }).catch(() => undefined);
}
