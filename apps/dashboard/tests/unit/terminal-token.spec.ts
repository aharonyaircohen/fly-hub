import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT } from "@kody-ade/fly/plugin/terminal/bridge-stateless-script";

import {
  mintTerminalBridgeToken,
  verifyTerminalBridgeToken,
} from "@kody-ade/terminal/terminal-token";

const SECRET = "test-master-secret";

describe("terminal bridge token", () => {
  it("carries the personal workspace through encryption and the gateway open request", () => {
    const token = mintTerminalBridgeToken({
      owner: "account",
      repo: "personal-brain",
      app: "brain-app",
      machineId: "machine-1",
      workspace: "machine",
      flyToken: "private-token",
      chatSessionId: "session",
      secret: SECRET,
    });
    const claims = verifyTerminalBridgeToken(token, { secret: SECRET });
    const start = TERMINAL_BRIDGE_STATELESS_SCRIPT.indexOf(
      "function openRequest(",
    );
    const end = TERMINAL_BRIDGE_STATELESS_SCRIPT.indexOf(
      "function parseAgentEvent(",
      start,
    );
    const request = runInNewContext(
      TERMINAL_BRIDGE_STATELESS_SCRIPT.slice(start, end) +
        "\nopenRequest(claims, 0)",
      { claims },
    );
    expect(request.workspace).toBe("machine");
    expect(request.session.scope).toMatchObject({
      owner: "account",
      repo: "personal-brain",
    });
    expect(JSON.stringify(request)).not.toContain("private-token");
  });
  it("round-trips encrypted launch claims", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      chatSessionId: "chat-1",
      conversationId: "conversation-1",
      afterRevision: 7,
      activityLimitMs: 2 * 60 * 60_000,
      flyToken: "FlyV1 secret-token",
      orgSlug: "guy-koren",
      cols: 132,
      rows: 40,
      now: 100,
      secret: SECRET,
    });

    expect(token).not.toContain("secret-token");
    const claims = verifyTerminalBridgeToken(token, {
      now: 110,
      secret: SECRET,
    });
    expect(claims).toMatchObject({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      chatSessionId: "chat-1",
      conversationId: "conversation-1",
      afterRevision: 7,
      activityLimitMs: 2 * 60 * 60_000,
      flyToken: "FlyV1 secret-token",
      orgSlug: "guy-koren",
      cols: 132,
      rows: 40,
    });
  });

  it("round-trips a never-expiring terminal activity limit", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-brain-alice",
      machineId: "brain-1",
      chatSessionId: "chat-1",
      activityLimitMs: null,
      flyToken: "FlyV1 secret-token",
      now: 100,
      secret: SECRET,
    });

    const claims = verifyTerminalBridgeToken(token, {
      now: 110,
      secret: SECRET,
    });
    expect(claims.activityLimitMs).toBeNull();
  });

  it("round-trips local exec GHCR claims without a machine target", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-brain-alice",
      localExec: true,
      flyToken: "FlyV1 secret-token",
      ghcrToken: "ghcr-secret-token",
      now: 100,
      secret: SECRET,
    });

    expect(token).not.toContain("ghcr-secret-token");
    const claims = verifyTerminalBridgeToken(token, {
      now: 110,
      secret: SECRET,
    });
    expect(claims).toMatchObject({
      app: "kody-brain-alice",
      localExec: true,
      flyToken: "FlyV1 secret-token",
      ghcrToken: "ghcr-secret-token",
    });
    expect(claims.machineId).toBeUndefined();
  });

  it("rejects tampered tokens", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      flyToken: "fly-token",
      now: 100,
      secret: SECRET,
    });

    const tampered = `${token.slice(0, -1)}x`;
    expect(() =>
      verifyTerminalBridgeToken(tampered, { now: 110, secret: SECRET }),
    ).toThrow(/signature invalid|payload invalid|malformed/);
  });

  it("rejects expired tokens", () => {
    const token = mintTerminalBridgeToken({
      owner: "acme",
      repo: "widgets",
      app: "kody-runner",
      machineId: "m-123",
      flyToken: "fly-token",
      now: 100,
      ttlSeconds: 5,
      secret: SECRET,
    });

    expect(() =>
      verifyTerminalBridgeToken(token, { now: 106, secret: SECRET }),
    ).toThrow(/expired/);
  });
});
