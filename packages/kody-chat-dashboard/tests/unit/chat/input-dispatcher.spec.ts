import { describe, expect, it, vi } from "vitest";

import { createChatInputDispatcher } from "../../../src/dashboard/lib/chat/platform/input-dispatcher";

describe("chat input dispatcher", () => {
  it("dispatches a registered operation with parsed arguments", async () => {
    const execute = vi.fn(async (args: readonly string[]) => ({
      summary: `force=${args.includes("--force")}`,
    }));
    const dispatcher = createChatInputDispatcher([
      { command: "/init", execute },
    ]);

    await expect(dispatcher.dispatch(" /init --force ")).resolves.toEqual({
      handled: true,
      command: "/init",
      result: { summary: "force=true" },
    });
    expect(execute).toHaveBeenCalledWith(["--force"]);
  });

  it("leaves prompt shortcuts, normal text, and lookalikes unhandled", async () => {
    const dispatcher = createChatInputDispatcher([
      { command: "/init", execute: vi.fn() },
    ]);

    await expect(dispatcher.dispatch("/review")).resolves.toEqual({
      handled: false,
    });
    await expect(dispatcher.dispatch("hello")).resolves.toEqual({
      handled: false,
    });
    await expect(dispatcher.dispatch("//init")).resolves.toEqual({
      handled: false,
    });
  });

  it("rejects duplicate command registrations", () => {
    expect(() =>
      createChatInputDispatcher([
        { command: "/init", execute: vi.fn() },
        { command: "/init", execute: vi.fn() },
      ]),
    ).toThrow('Duplicate chat operation "/init"');
  });
});
