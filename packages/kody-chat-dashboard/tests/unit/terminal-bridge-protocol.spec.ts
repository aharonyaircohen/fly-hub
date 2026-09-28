import { describe, expect, it } from "vitest";

import { parseTerminalBridgeServerMessage } from "@kody-ade/terminal/bridge-protocol";

describe("terminal bridge protocol", () => {
  it("parses typed output messages", () => {
    expect(
      parseTerminalBridgeServerMessage(
        JSON.stringify({ type: "output", data: "hello" }),
      ),
    ).toEqual({ type: "output", data: "hello" });
  });

  it("rejects malformed output messages", () => {
    expect(
      parseTerminalBridgeServerMessage(JSON.stringify({ type: "output" })),
    ).toBeNull();
  });

  it("parses terminal exit messages", () => {
    expect(
      parseTerminalBridgeServerMessage(
        JSON.stringify({ type: "exit", code: 0 }),
      ),
    ).toEqual({ type: "exit", code: 0 });
  });

  it("parses heartbeat replies", () => {
    expect(
      parseTerminalBridgeServerMessage(JSON.stringify({ type: "pong" })),
    ).toEqual({ type: "pong" });
  });

  it("parses restore lifecycle messages", () => {
    expect(
      parseTerminalBridgeServerMessage(
        JSON.stringify({ type: "restore-start", replayBytes: 120 }),
      ),
    ).toEqual({ type: "restore-start", replayBytes: 120 });

    expect(
      parseTerminalBridgeServerMessage(JSON.stringify({ type: "restore-complete" })),
    ).toEqual({ type: "restore-complete" });
  });

  it("returns null for raw terminal bytes", () => {
    expect(parseTerminalBridgeServerMessage("root@brain:/workspace# ")).toBeNull();
  });
});
