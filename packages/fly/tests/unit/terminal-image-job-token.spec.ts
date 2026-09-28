import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT } from "../../src/plugin/terminal/bridge-stateless-script";

const secret = "test-image-job-secret";
const source = TERMINAL_BRIDGE_STATELESS_SCRIPT.slice(
  TERMINAL_BRIDGE_STATELESS_SCRIPT.indexOf("const TOKEN_VERSION"),
  TERMINAL_BRIDGE_STATELESS_SCRIPT.indexOf("function sendFrame"),
);
const verify = new Function(
  "crypto",
  "process",
  "Buffer",
  `${source}; return verifyTerminalToken;`,
)(crypto, { env: { BRIDGE_AUTH_SECRET: secret } }, Buffer) as (
  token: string,
) => { localExec?: boolean };
const input = {
  owner: "personal-user",
  repo: "personal-brain",
  app: "brain-app",
  machineId: "machine-1",
  flyToken: "test-fly",
  secret,
};

describe("image jobs through the terminal gateway", () => {
  it("accepts the restore token shape without a machine", () => {
    expect(
      verify(
        mintTerminalBridgeToken({
          ...input,
          machineId: undefined,
          localExec: true,
        }),
      ).localExec,
    ).toBe(true);
  });
  it("requires a real machine for interactive connections", () => {
    expect(() =>
      verify(
        mintTerminalBridgeToken({
          ...input,
          machineId: undefined,
          chatSessionId: "chat-1",
        }),
      ),
    ).toThrow("machine invalid");
  });
  it("accepts authorized image jobs without inventing a chat session", () => {
    expect(
      verify(mintTerminalBridgeToken({ ...input, localExec: true })).localExec,
    ).toBe(true);
  });
  it("still requires a session for interactive terminal tokens", () => {
    expect(() => verify(mintTerminalBridgeToken(input))).toThrow(
      "session invalid",
    );
    expect(() =>
      verify(mintTerminalBridgeToken({ ...input, chatSessionId: "chat-1" })),
    ).not.toThrow();
  });
  it("does not relax signature checks for image jobs", () => {
    expect(() =>
      verify(
        mintTerminalBridgeToken({ ...input, localExec: true, secret: "wrong" }),
      ),
    ).toThrow("signature invalid");
  });
});
