import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLEANUP_WATCHDOG_FLAG = "--cleanup-watchdog";

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} tempBase
 */
export function createLocalBrainWorkspace(env = process.env, tempBase = tmpdir()) {
  const configured = env.BRAIN_REPOS_ROOT?.trim();
  if (configured) return { path: resolve(configured), owned: false };
  return {
    path: mkdtempSync(join(tempBase, "kody-brain-repos-")),
    owned: true,
  };
}

export function cleanupLocalBrainWorkspace(workspace) {
  if (!workspace.owned) return;
  rmSync(workspace.path, { recursive: true, force: true });
}

/**
 * @param {{ kill: (signal: "SIGINT" | "SIGTERM") => unknown }} child
 * @param {{ path: string, owned: boolean }} workspace
 * @param {"SIGINT" | "SIGTERM"} signal
 */
export function stopLocalBrain(child, workspace, signal) {
  child.kill(signal);
  cleanupLocalBrainWorkspace(workspace);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isOwnedTemporaryWorkspace(workspacePath) {
  const resolvedPath = resolve(workspacePath);
  const temporaryRoot = resolve(tmpdir());
  return (
    resolvedPath.startsWith(`${temporaryRoot}${sep}`) &&
    basename(resolvedPath).startsWith("kody-brain-repos-")
  );
}

async function runCleanupWatchdog(ownerPid, workspacePath) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;
  if (!isOwnedTemporaryWorkspace(workspacePath)) return;
  while (processExists(ownerPid)) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  rmSync(workspacePath, { recursive: true, force: true });
}

export function startLocalBrainCleanupWatchdog(
  workspace,
  ownerPid = process.pid,
) {
  if (!workspace.owned) return null;
  const watchdog = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      CLEANUP_WATCHDOG_FLAG,
      String(ownerPid),
      workspace.path,
    ],
    { detached: true, stdio: "ignore" },
  );
  watchdog.unref();
  return watchdog.pid;
}

export function runLocalBrain() {
  const workspace = createLocalBrainWorkspace();
  startLocalBrainCleanupWatchdog(workspace);
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(
    executable,
    [
      "-y",
      "-p",
      "@kody-ade/kody-engine@latest",
      "kody-engine",
      "brain-serve",
    ],
    {
      env: { ...process.env, BRAIN_REPOS_ROOT: workspace.path },
      stdio: "inherit",
    },
  );

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupLocalBrainWorkspace(workspace);
  };
  process.once("exit", cleanup);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      stopLocalBrain(child, workspace, signal);
      cleaned = true;
    });
  }

  child.once("error", (error) => {
    console.error(`[brain:local] ${error.message}`);
    cleanup();
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanup();
    process.exitCode = signal ? 1 : (code ?? 1);
  });

  return { child, workspace };
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedUrl) {
  if (process.argv[2] === CLEANUP_WATCHDOG_FLAG) {
    await runCleanupWatchdog(Number(process.argv[3]), process.argv[4] ?? "");
  } else {
    runLocalBrain();
  }
}
