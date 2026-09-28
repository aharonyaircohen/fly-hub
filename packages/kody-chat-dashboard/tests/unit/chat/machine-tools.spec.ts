import { describe, expect, it, vi } from "vitest";
import { createMachineTools } from "../../../app/api/kody/chat/tools/machine-tools";

describe("machine tools", () => {
  it("does not expose a machine tool without explicit Local access", () => {
    expect(
      createMachineTools({
        machineAccess: "none",
        localEnabled: true,
      }),
    ).toEqual({});
  });

  it("does not expose a machine tool when the host disabled Local access", () => {
    expect(
      createMachineTools({
        machineAccess: "local",
        localEnabled: false,
      }),
    ).toEqual({});
  });

  it("exposes one general machine tool and delegates bounded commands", async () => {
    const executeCommand = vi.fn(async () => ({
      code: 0,
      stdout: "ok",
      stderr: "",
    }));
    const tools = createMachineTools({
      machineAccess: "local",
      localEnabled: true,
      executeCommand,
    });
    const machine = tools.machine as unknown as {
      execute: (input: { command: string; cwd?: string }) => Promise<unknown>;
    };

    await expect(
      machine.execute({ command: "pwd", cwd: "/tmp" }),
    ).resolves.toEqual({ code: 0, stdout: "ok", stderr: "" });
    expect(executeCommand).toHaveBeenCalledWith({
      command: "pwd",
      cwd: "/tmp",
      timeoutMs: 300_000,
      maxOutputBytes: 1_000_000,
    });
    expect(Object.keys(tools)).toEqual(["machine"]);
  });
});
