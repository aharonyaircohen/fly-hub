import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const packageRoot = resolve(import.meta.dirname, "..");
const libraryRoot = resolve(packageRoot, "../kody-chat");
const fixtureRoot = join(packageRoot, "tests/external-consumer");
const temporaryRoot = await mkdtemp(join(tmpdir(), "kody-chat-consumer-"));
const packageSpec = process.env.KODY_CHAT_PACKAGE_SPEC?.trim();
const libraryPackage = JSON.parse(
  await readFile(join(libraryRoot, "package.json"), "utf8"),
);
const resolvedPackageSpec =
  packageSpec === "registry"
    ? libraryPackage.version
    : packageSpec?.startsWith(`${libraryPackage.name}@`)
      ? packageSpec.slice(`${libraryPackage.name}@`.length)
      : packageSpec;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: temporaryRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

await cp(fixtureRoot, temporaryRoot, { recursive: true });
await mkdir(join(temporaryRoot, "public"), { recursive: true });
await cp(
  join(temporaryRoot, "index.html"),
  join(temporaryRoot, "public/index.html"),
);
if (resolvedPackageSpec) {
  const fixturePackagePath = join(temporaryRoot, "package.json");
  const fixturePackage = JSON.parse(await readFile(fixturePackagePath, "utf8"));
  fixturePackage.dependencies[libraryPackage.name] = resolvedPackageSpec;
  await writeFile(
    fixturePackagePath,
    `${JSON.stringify(fixturePackage, null, 2)}\n`,
  );
} else {
  await run("npm", ["pack", libraryRoot, "--pack-destination", temporaryRoot]);
  const tarballName = `kody-ade-kody-chat-${libraryPackage.version}.tgz`;
  await rename(
    join(temporaryRoot, basename(tarballName)),
    join(temporaryRoot, "kody-chat.tgz"),
  );
}
await run("npm", ["install", "--no-audit", "--no-fund"]);
await cp(
  join(temporaryRoot, "node_modules/@kody-ade/kody-chat/styles.css"),
  join(temporaryRoot, "public/styles.css"),
);
await run("npm", ["run", "build"]);

const server = spawn("node", ["server.mjs"], {
  cwd: temporaryRoot,
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolvePromise, reject) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("ready")) resolvePromise();
  });
  server.on("error", reject);
  server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
});

try {
  await run(resolve(temporaryRoot, "node_modules/.bin/playwright"), [
    "test",
    "external-consumer.spec.ts",
    "--workers=1",
  ]);
} finally {
  server.kill("SIGTERM");
}

process.stdout.write(`External package verified in ${temporaryRoot}\n`);
