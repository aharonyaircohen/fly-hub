import { describe, it, expect } from "vitest";
import { captureTerminalOutput } from "../../../src/dashboard/lib/chat/plugins/terminal/terminal-text";
describe("terminal history", () => {
  it("keeps one copy after typing, cursor moves, and repeated full-screen updates", () => {
    let history = "";
    for (const input of ["", "l", "ls", "ls", "ls\r\nfile.txt\r\n$ "]) {
      history = captureTerminalOutput(
        history,
        `\x1b[3J\x1b[2J\x1b[H$ ${input}`,
      );
    }
    expect(history).toBe("$ ls\nfile.txt\n$ ");
  });
  it("replaces cleared history and keeps local output chunks", () => {
    expect(captureTerminalOutput("old command", "\x1b[2J\x1b[H$ ")).toBe("$ ");
    expect(captureTerminalOutput("first\n", "second\r\n")).toBe(
      "first\nsecond\n",
    );
  });
});
