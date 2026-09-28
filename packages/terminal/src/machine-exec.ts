import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export interface LocalMachineCommandInput {
  command: string;
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface LocalMachineCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function isLocalMachineAccessEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.KODY_LOCAL_MACHINE_ACCESS === "1";
}

async function resolveWorkingDirectory(cwd: string | undefined) {
  if (!cwd) return process.cwd();
  if (!isAbsolute(cwd)) {
    throw new Error("Machine command cwd must be an absolute path");
  }
  const metadata = await stat(cwd).catch(() => null);
  if (!metadata?.isDirectory()) {
    throw new Error("Machine command cwd must be an existing directory");
  }
  return cwd;
}

function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }
  return {
    file: process.env.SHELL ?? "/bin/sh",
    args: ["-lc", command],
  };
}

export async function runLocalMachineCommand(
  input: LocalMachineCommandInput,
): Promise<LocalMachineCommandResult> {
  if (!input.command.trim()) throw new Error("Machine command is required");
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Machine command timeout must be positive");
  }
  if (!Number.isFinite(input.maxOutputBytes) || input.maxOutputBytes <= 0) {
    throw new Error("Machine command output limit must be positive");
  }

  const cwd = await resolveWorkingDirectory(input.cwd);
  const shell = shellCommand(input.command);

  return await new Promise<LocalMachineCommandResult>((resolve, reject) => {
    const usesProcessGroup = process.platform !== "win32";
    const child = spawn(shell.file, shell.args, {
      cwd,
      env: process.env,
      detached: usesProcessGroup,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      if (usesProcessGroup && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // The process may have exited between the failure and cleanup.
        }
      }
      child.kill("SIGKILL");
    };

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      terminate();
      reject(error);
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
        finishWithError(
          new Error(
            `Machine command output exceeded ${input.maxOutputBytes} bytes`,
          ),
        );
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", finishWithError);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    timer = setTimeout(
      () =>
        finishWithError(
          new Error(`Machine command timed out after ${input.timeoutMs}ms`),
        ),
      input.timeoutMs,
    );
  });
}
