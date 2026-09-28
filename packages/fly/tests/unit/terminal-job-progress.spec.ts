import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { describe, expect, it } from "vitest";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT as script } from "../../src/plugin/terminal/bridge-stateless-script";

describe("gateway execution progress", () => {
  it("publishes progress before process exit and bounds stderr too", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => true,
    });
    const source = script.slice(
      script.indexOf("function runCommand("),
      script.indexOf("function bearerToken("),
    );
    const start = new Function(
      "StringDecoder",
      "spawn",
      "crypto",
      "process",
      "Buffer",
      "setTimeout",
      "clearTimeout",
      "MAX_EXEC_TIMEOUT_MS",
      "MAX_EXEC_OUTPUT_BYTES",
      "execJobs",
      `${source}; return startJob;`,
    )(
      StringDecoder,
      () => child,
      crypto,
      { env: {} },
      Buffer,
      setTimeout,
      clearTimeout,
      1000,
      1024,
      new Map(),
    );
    const job = start(
      { localExec: true, owner: "a", repo: "b", app: "c", flyToken: "secret" },
      { local: true, command: "test", maxOutputBytes: 1024, timeoutMs: 1000 },
    );
    child.stdout.emit(
      "data",
      Buffer.from("__KODY_BRAIN_SAVE_STAGE=export-rootfs\n"),
    );
    expect(job.stdout).toContain("export-rootfs");
    expect(job.status).toBe("running");
    expect(
      start(
        {
          localExec: true,
          owner: "a",
          repo: "b",
          app: "c",
          flyToken: "secret",
        },
        { jobId: job.id, local: true, command: "test" },
      ),
    ).toBe(job);
    expect(() =>
      start(
        {
          localExec: true,
          owner: "other",
          repo: "b",
          app: "c",
          flyToken: "secret",
        },
        { jobId: job.id, local: true, command: "test" },
      ),
    ).toThrow("not accessible");
    child.stderr.emit("data", Buffer.alloc(1100, "x"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(job.status).toBe("failed");
    expect(job.error).toContain("output too large");
  });
});
