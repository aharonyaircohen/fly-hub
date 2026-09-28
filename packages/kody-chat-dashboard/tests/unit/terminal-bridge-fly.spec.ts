import { describe, expect, it } from "vitest";
import ts from "typescript";

import {
  TERMINAL_BRIDGE_SCRIPT,
  TERMINAL_BRIDGE_START_SCRIPT,
  TERMINAL_BRIDGE_VERSION,
  terminalBridgeAppName,
  terminalBridgeVersionFor,
} from "@kody-ade/fly/plugin/terminal/bridge";

const config = {
  token: "fly-test-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

describe("stateless terminal gateway", () => {
  it("has deterministic deployment identity", () => {
    expect(terminalBridgeAppName(config)).toBe(
      terminalBridgeAppName(config),
    );
    expect(TERMINAL_BRIDGE_VERSION).toBe(
      terminalBridgeVersionFor({
        startScript: TERMINAL_BRIDGE_START_SCRIPT,
        bridgeScript: TERMINAL_BRIDGE_SCRIPT,
      }),
    );
    expect(
      terminalBridgeVersionFor({
        startScript: `${TERMINAL_BRIDGE_START_SCRIPT}\n# changed`,
        bridgeScript: TERMINAL_BRIDGE_SCRIPT,
      }),
    ).not.toBe(TERMINAL_BRIDGE_VERSION);
  });

  it("is transport-only and delegates durable lifecycle to the Brain agent", () => {
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "kody-engine brain-terminal-agent --cwd /workspace/repo",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("afterRevision");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('type: "transport-status"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("scheduleReconnect(");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      'closeSocket(socket, 1011, "Brain terminal transport unavailable")',
    );
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("persistentSessions");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("tmux");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("AGENT_RETRY");
    expect(TERMINAL_BRIDGE_START_SCRIPT).not.toContain("python");
    expect(TERMINAL_BRIDGE_START_SCRIPT).not.toContain("tmux");
  });

  it("ships syntactically valid JavaScript", () => {
    const result = ts.transpileModule(TERMINAL_BRIDGE_SCRIPT, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    expect(
      result.diagnostics?.filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      ),
    ).toEqual([]);
  });
});
