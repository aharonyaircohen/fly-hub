import { tool } from "ai";
import { z } from "zod";
import {
  runLocalMachineCommand,
  type LocalMachineCommandInput,
  type LocalMachineCommandResult,
} from "@kody-ade/terminal/machine-exec";
import type { MachineAccess } from "../../../../../src/dashboard/lib/chat-types";

const MACHINE_TIMEOUT_MS = 300_000;
const MACHINE_MAX_OUTPUT_BYTES = 1_000_000;

interface CreateMachineToolsOptions {
  machineAccess: MachineAccess;
  localEnabled: boolean;
  executeCommand?: (
    input: LocalMachineCommandInput,
  ) => Promise<LocalMachineCommandResult>;
}

export function createMachineTools(options: CreateMachineToolsOptions) {
  if (options.machineAccess !== "local" || !options.localEnabled) return {};
  const executeCommand = options.executeCommand ?? runLocalMachineCommand;

  return {
    machine: tool({
      description:
        "Run a shell command on the machine hosting Kody. The command has the same filesystem and process permissions as the Kody host user. Use an absolute cwd when a specific directory matters.",
      inputSchema: z.object({
        command: z.string().trim().min(1).max(100_000),
        cwd: z.string().trim().min(1).optional(),
      }),
      execute: async ({ command, cwd }) =>
        executeCommand({
          command,
          cwd,
          timeoutMs: MACHINE_TIMEOUT_MS,
          maxOutputBytes: MACHINE_MAX_OUTPUT_BYTES,
        }),
    }),
  };
}
