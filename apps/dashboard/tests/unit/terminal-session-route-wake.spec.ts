/**
 * @fileoverview Source-level guard for Brain terminal wake wait bounds.
 * @testFramework vitest
 * @domain terminal
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../../../packages/fly/src/routes/terminal-session.ts"),
  "utf8",
);
const USE_CASE_SOURCE = readFileSync(
  resolve(__dirname, "../../../../packages/fly/src/terminal/session-connect.ts"),
  "utf8",
);

describe("terminal session wake wait", () => {
  it("waits long enough for Brain machines while keeping a hard route bound", () => {
    expect(ROUTE_SOURCE).toContain("export const maxDuration = 90;");
    expect(USE_CASE_SOURCE).toContain("const WAKE_POLL_ATTEMPTS = 60;");
    expect(USE_CASE_SOURCE).toContain("const WAKE_POLL_INTERVAL_MS = 1000;");
    expect(USE_CASE_SOURCE).toContain("Brain machine did not become ready in time");
  });

  it("uses the public Brain health edge to wake a machine before polling", () => {
    expect(USE_CASE_SOURCE).toContain("serverProviderHostname");
    expect(USE_CASE_SOURCE).toContain("globalThis.fetch");
    expect(USE_CASE_SOURCE).toContain("/healthz");
    expect(USE_CASE_SOURCE).toContain("EDGE_WAKE_TIMEOUT_MS");
    const connectBoundary = USE_CASE_SOURCE.slice(
      USE_CASE_SOURCE.indexOf("export async function connectTerminalMachine"),
    );
    expect(
      connectBoundary.indexOf(
        "await wakeServerProviderMachineThroughEdge(requested.app)",
      ),
    ).toBeLessThan(connectBoundary.indexOf("const next = await refreshMachine()"));
  });

  it("does not report Brain Fly authorization failures as missing machines", () => {
    expect(USE_CASE_SOURCE).toContain("fly_access_denied");
    expect(USE_CASE_SOURCE).toContain(
      'savedBrain?.brain.reason === "fly_access_denied"',
    );
    expect(USE_CASE_SOURCE).toContain("Fly token cannot access this Brain app.");
  });
});
