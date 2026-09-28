import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mintTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";
import {
  TERMINAL_BRIDGE_SCRIPT,
  TERMINAL_BRIDGE_START_SCRIPT,
} from "../../src/plugin/terminal/bridge";

const SECRET = "gateway-process-test-secret";
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port unavailable");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // Process startup is asynchronous.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("gateway did not become healthy");
}

function nextMessages(
  socket: WebSocket,
  count: number,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const onMessage = (event: MessageEvent) => {
      messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
      if (messages.length === count) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("websocket failed"));
    };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

function token(
  afterRevision?: number,
  options: { localExec?: boolean } = {},
): string {
  return mintTerminalBridgeToken({
    owner: "acme",
    repo: "widgets",
    app: "brain-test",
    machineId: "machine-1",
    chatSessionId: "terminal-1",
    conversationId: "conversation-1",
    afterRevision,
    flyToken: "FlyV1 test",
    cols: 100,
    rows: 30,
    secret: SECRET,
    ...(options.localExec ? { localExec: true } : {}),
  });
}

describe("stateless terminal gateway process", () => {
  it("installs direct SSH transport before serving traffic", () => {
    expect(TERMINAL_BRIDGE_START_SCRIPT).toContain("openssh-client");
    expect(TERMINAL_BRIDGE_START_SCRIPT).toContain(
      "wire_guard_websockets: true",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('spawn("ssh-agent"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(".vm.\" + claims.app + \".internal");
  });

  it("opens one Brain agent per socket and forwards the same revision on reconnect", async () => {
    const root = mkdtempSync(join(tmpdir(), "kody-gateway-"));
    roots.push(root);
    const gatewayPath = join(root, "bridge.mjs");
    const sshAgentPath = join(root, "ssh-agent");
    const logPath = join(root, "agent-requests.jsonl");
    writeFileSync(gatewayPath, TERMINAL_BRIDGE_SCRIPT);
    writeFileSync(
      sshAgentPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
let generation = 1;
lines.on("line", (line) => {
  const value = JSON.parse(line);
  fs.appendFileSync(process.env.AGENT_LOG, JSON.stringify({ ...value, brainHost: process.env.KODY_BRAIN_HOST }) + "\\n");
  if (value.type === "open") {
    process.stdout.write(JSON.stringify({ type: "state", sessionId: value.session.id, generation, state: "ready" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "output", sessionId: value.session.id, generation, revision: 1, data: "durable screen" }) + "\\n");
  } else if (value.type === "input") {
    process.stdout.write(JSON.stringify({ type: "input-accepted", sessionId: value.sessionId, generation, inputId: value.inputId }) + "\\n");
  }
});
`,
    );
    chmodSync(sshAgentPath, 0o755);
    const port = await unusedPort();
    const child = spawn(process.execPath, [gatewayPath], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        PORT: String(port),
        BRIDGE_AUTH_SECRET: SECRET,
        AGENT_LOG: logPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForHealth(port);

    const first = new WebSocket(`ws://127.0.0.1:${port}/?token=${token()}`);
    const firstMessages = nextMessages(first, 2);
    await new Promise<void>((resolve, reject) => {
      first.addEventListener("open", () => resolve(), { once: true });
      first.addEventListener("error", () => reject(new Error("open failed")), {
        once: true,
      });
    });
    const [firstState, firstOutput] = await firstMessages;
    expect(firstState).toMatchObject({
      type: "state",
      sessionId: "terminal-1",
      generation: 1,
      state: "ready",
    });
    expect(firstOutput).toMatchObject({
      type: "output",
      revision: 1,
      data: "durable screen",
    });
    const accepted = nextMessages(first, 1);
    first.send(
      JSON.stringify({
        type: "input",
        sessionId: "terminal-1",
        inputId: "input-1",
        data: "pwd\r",
      }),
    );
    await expect(accepted).resolves.toEqual([
      expect.objectContaining({ type: "input-accepted", inputId: "input-1" }),
    ]);
    first.close();

    const second = new WebSocket(
      `ws://127.0.0.1:${port}/?token=${token(1)}`,
    );
    const secondMessages = nextMessages(second, 1);
    await new Promise<void>((resolve, reject) => {
      second.addEventListener("open", () => resolve(), { once: true });
      second.addEventListener("error", () => reject(new Error("open failed")), {
        once: true,
      });
    });
    const [secondState] = await secondMessages;
    expect(secondState).toMatchObject({
      type: "state",
      sessionId: "terminal-1",
      generation: 1,
      state: "ready",
    });
    second.close();

    await new Promise((resolve) => setTimeout(resolve, 30));
    const opens = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((value) => value.type === "open");
    const inputs = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((value) => value.type === "input");
    expect(opens).toHaveLength(2);
    expect(inputs).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      afterRevision: 0,
      brainHost: "machine-1.vm.brain-test.internal",
    });
    expect(opens[1]).toMatchObject({ afterRevision: 1 });
  });

  it("runs authenticated local commands and exposes completed job output", async () => {
    const root = mkdtempSync(join(tmpdir(), "kody-gateway-exec-"));
    roots.push(root);
    const gatewayPath = join(root, "bridge.mjs");
    const flyctlPath = join(root, "flyctl");
    writeFileSync(gatewayPath, TERMINAL_BRIDGE_SCRIPT);
    writeFileSync(flyctlPath, "#!/bin/sh\nexit 1\n");
    chmodSync(flyctlPath, 0o755);
    const port = await unusedPort();
    const child = spawn(process.execPath, [gatewayPath], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        PORT: String(port),
        BRIDGE_AUTH_SECRET: SECRET,
        TERMINAL_UPSTREAM_TRANSPORT: "flyctl",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForHealth(port);
    const auth = {
      Authorization: `Bearer ${token(undefined, { localExec: true })}`,
    };

    const direct = await fetch(`http://127.0.0.1:${port}/exec`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        command:
          'test "$FLY_API_TOKEN" = "FlyV1 test" && printf direct-output',
        local: true,
      }),
    });
    await expect(direct.json()).resolves.toMatchObject({
      ok: true,
      code: 0,
      stdout: "direct-output",
    });

    const started = await fetch(`http://127.0.0.1:${port}/jobs`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "printf job-output; printf job-warning >&2",
        local: true,
      }),
    });
    const startedBody = (await started.json()) as { job: { id: string } };
    let completed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(
        `http://127.0.0.1:${port}/jobs/${startedBody.job.id}`,
        { headers: auth },
      );
      const body = (await response.json()) as {
        job?: Record<string, unknown>;
      };
      if (body.job?.status !== "running") {
        completed = body.job ?? null;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(completed).toMatchObject({
      status: "completed",
      code: 0,
      stdout: "job-output",
      stderr: "job-warning",
    });
  });

  it("reports Brain tunnel failures as transport errors, not authentication failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "kody-gateway-status-"));
    roots.push(root);
    const gatewayPath = join(root, "bridge.mjs");
    const flyctlPath = join(root, "flyctl");
    writeFileSync(gatewayPath, TERMINAL_BRIDGE_SCRIPT);
    writeFileSync(
      flyctlPath,
      "#!/bin/sh\necho 'tunnel unavailable: context deadline exceeded' >&2\nexit 1\n",
    );
    chmodSync(flyctlPath, 0o755);
    const port = await unusedPort();
    const child = spawn(process.execPath, [gatewayPath], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        PORT: String(port),
        BRIDGE_AUTH_SECRET: SECRET,
        TERMINAL_UPSTREAM_TRANSPORT: "flyctl",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForHealth(port);
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "terminal_transport_unavailable",
      message: expect.stringContaining("tunnel unavailable"),
    });
  });

  it("recovers Fly tunnel failures without closing the browser socket", async () => {
    const root = mkdtempSync(join(tmpdir(), "kody-gateway-recovery-"));
    roots.push(root);
    const gatewayPath = join(root, "bridge.mjs");
    const flyctlPath = join(root, "flyctl");
    const attemptsPath = join(root, "attempts");
    writeFileSync(gatewayPath, TERMINAL_BRIDGE_SCRIPT);
    writeFileSync(
      flyctlPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = process.env.ATTEMPTS_PATH;
const attempt = fs.existsSync(path) ? Number(fs.readFileSync(path, "utf8")) + 1 : 1;
fs.writeFileSync(path, String(attempt));
if (attempt < 3) {
  process.stderr.write('tunnel unavailable: context deadline exceeded\\n');
  process.exit(1);
}
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const value = JSON.parse(line);
  if (value.type === "open") {
    process.stdout.write(JSON.stringify({ type: "state", sessionId: value.session.id, generation: 1, state: "ready" }) + "\\n");
  }
});
`,
    );
    chmodSync(flyctlPath, 0o755);
    const port = await unusedPort();
    const child = spawn(process.execPath, [gatewayPath], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ""}`,
        PORT: String(port),
        BRIDGE_AUTH_SECRET: SECRET,
        ATTEMPTS_PATH: attemptsPath,
        TERMINAL_UPSTREAM_RETRY_BASE_MS: "10",
        TERMINAL_UPSTREAM_RETRY_MAX_MS: "20",
        TERMINAL_UPSTREAM_TRANSPORT: "flyctl",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForHealth(port);

    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token()}`);
    const messages = nextMessages(socket, 3);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("open failed")), {
        once: true,
      });
    });

    const [firstRetry, secondRetry, ready] = await messages;
    expect(firstRetry).toMatchObject({
      type: "transport-status",
      phase: "reconnecting",
      attempt: 2,
      message: "Reconnecting to Brain…",
    });
    expect(secondRetry).toMatchObject({
      type: "transport-status",
      phase: "reconnecting",
      attempt: 3,
    });
    expect(ready).toMatchObject({
      type: "state",
      sessionId: "terminal-1",
      state: "ready",
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(readFileSync(attemptsPath, "utf8")).toBe("3");
    socket.close();
  });
});
