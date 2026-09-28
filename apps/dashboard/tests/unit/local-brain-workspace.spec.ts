import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupLocalBrainWorkspace,
  createLocalBrainWorkspace,
  startLocalBrainCleanupWatchdog,
  stopLocalBrain,
} from "../../scripts/run-local-brain.mjs";

describe("local Brain workspace", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it("creates and removes an owned temporary repo root", () => {
    const parent = mkdtempSync(join(tmpdir(), "kody-brain-test-"));
    roots.push(parent);

    const workspace = createLocalBrainWorkspace({}, parent);

    expect(workspace.owned).toBe(true);
    expect(workspace.path.startsWith(parent)).toBe(true);
    expect(existsSync(workspace.path)).toBe(true);

    cleanupLocalBrainWorkspace(workspace);
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("preserves an explicitly configured repo root", () => {
    const parent = mkdtempSync(join(tmpdir(), "kody-brain-test-"));
    const configured = join(parent, "configured");
    mkdirSync(configured);
    roots.push(parent);

    const workspace = createLocalBrainWorkspace(
      { BRAIN_REPOS_ROOT: configured },
      parent,
    );

    expect(workspace).toEqual({ path: configured, owned: false });
    cleanupLocalBrainWorkspace(workspace);
    expect(existsSync(configured)).toBe(true);
  });

  it("removes an owned workspace immediately when the runner is stopped", () => {
    const parent = mkdtempSync(join(tmpdir(), "kody-brain-test-"));
    roots.push(parent);
    const workspace = createLocalBrainWorkspace({}, parent);
    const signals: string[] = [];

    stopLocalBrain(
      { kill: (signal: string) => signals.push(signal) },
      workspace,
      "SIGTERM",
    );

    expect(signals).toEqual(["SIGTERM"]);
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("removes an owned workspace after the runner process is already gone", async () => {
    const parent = mkdtempSync(join(tmpdir(), "kody-brain-test-"));
    roots.push(parent);
    const workspace = createLocalBrainWorkspace({}, parent);
    const owner = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));

    startLocalBrainCleanupWatchdog(workspace, owner.pid!);

    await expect
      .poll(() => existsSync(workspace.path), { timeout: 3_000 })
      .toBe(false);
  });
});
