import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLocalMachineAccessEnabled,
  runLocalMachineCommand,
} from "../src/machine-exec";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local machine execution", () => {
  it("is disabled unless the host explicitly enables it", () => {
    expect(isLocalMachineAccessEnabled({})).toBe(false);
    expect(
      isLocalMachineAccessEnabled({ KODY_LOCAL_MACHINE_ACCESS: "1" }),
    ).toBe(true);
  });

  it("runs in the requested absolute working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kody-machine-"));
    temporaryDirectories.push(cwd);

    const result = await runLocalMachineCommand({
      command: "printf 'verified' > result.txt && pwd",
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 8_192,
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(await realpath(cwd));
    await expect(readFile(join(cwd, "result.txt"), "utf8")).resolves.toBe(
      "verified",
    );
  });

  it("rejects relative working directories", async () => {
    await expect(
      runLocalMachineCommand({
        command: "pwd",
        cwd: "relative/path",
        timeoutMs: 5_000,
        maxOutputBytes: 8_192,
      }),
    ).rejects.toThrow("absolute");
  });

  it("caps execution time", async () => {
    await expect(
      runLocalMachineCommand({
        command: "sleep 2",
        timeoutMs: 25,
        maxOutputBytes: 8_192,
      }),
    ).rejects.toThrow("timed out");
  });

  it("caps combined command output", async () => {
    await expect(
      runLocalMachineCommand({
        command: "printf '123456789'",
        timeoutMs: 5_000,
        maxOutputBytes: 4,
      }),
    ).rejects.toThrow("output exceeded");
  });
});
