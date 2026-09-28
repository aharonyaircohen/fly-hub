import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import {
  buildBrainTerminalOpenRequest,
  normalizeBrainTerminalCommand,
  parseBrainTerminalAgentLine,
} from "../../src/plugin/terminal/agent-proxy";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT } from "../../src/plugin/terminal/bridge-stateless-script";

const claims = {
  owner: "acme",
  repo: "widgets",
  chatSessionId: "terminal-1",
  conversationId: "conversation-1",
  afterRevision: 7,
  cols: 120,
  rows: 36,
};

describe("terminal agent proxy", () => {
  it("binds clear to the authenticated session and rejects other sessions", () => {
    expect(
      normalizeBrainTerminalCommand({ type: "clear" }, "terminal-1"),
    ).toEqual({ type: "clear", sessionId: "terminal-1" });
    expect(() =>
      normalizeBrainTerminalCommand(
        { type: "clear", sessionId: "other" },
        "terminal-1",
      ),
    ).toThrow("session identity");
  });

  it("opens the same Brain session and revision after transport replacement", () => {
    expect(buildBrainTerminalOpenRequest(claims)).toEqual({
      type: "open",
      session: {
        id: "terminal-1",
        scope: {
          owner: "acme",
          repo: "widgets",
          conversationId: "conversation-1",
        },
      },
      cwd: "/workspace/repo",
      afterRevision: 7,
      cols: 120,
      rows: 36,
    });
  });

  it("binds every browser command to the authenticated session", () => {
    expect(
      normalizeBrainTerminalCommand(
        { type: "input", inputId: "input-1", data: "codex\r" },
        "terminal-1",
      ),
    ).toEqual({
      type: "input",
      sessionId: "terminal-1",
      inputId: "input-1",
      data: "codex\r",
    });
    expect(() =>
      normalizeBrainTerminalCommand(
        { type: "detach", sessionId: "another-session" },
        "terminal-1",
      ),
    ).toThrow("session identity");
  });

  it("accepts only validated terminal agent events", () => {
    expect(
      parseBrainTerminalAgentLine(
        JSON.stringify({
          type: "output",
          sessionId: "terminal-1",
          generation: 2,
          revision: 9,
          data: "screen",
        }),
      ),
    ).toMatchObject({ type: "output", generation: 2, revision: 9 });
    expect(parseBrainTerminalAgentLine("flyctl diagnostic noise")).toBeNull();
    expect(
      parseBrainTerminalAgentLine(
        JSON.stringify({
          type: "output",
          sessionId: "terminal-1",
          data: "missing identity",
        }),
      ),
    ).toBeNull();
  });

  it("ships a syntactically valid standalone gateway", () => {
    const checked = spawnSync(
      process.execPath,
      ["--input-type=module", "--check", "-"],
      {
        input: TERMINAL_BRIDGE_STATELESS_SCRIPT,
        encoding: "utf8",
      },
    );
    expect(checked.stderr).toBe("");
    expect(checked.status).toBe(0);
  });
});
