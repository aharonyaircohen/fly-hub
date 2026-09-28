import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { BRAIN_AGENT_CLIENT } from "../../src/agent-client";
const directories: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  directories.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  servers.forEach((server) => server.close());
});
async function run(status = 200) {
  let request: unknown;
  let authorization: string | undefined;
  const server = createServer(async (req, res) => {
    authorization = req.headers.authorization;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    request = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? { values: { TEST_KEY: "private-value" } }
          : { error: "denied" },
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const dir = mkdtempSync(join(tmpdir(), "kody-agent-"));
  directories.push(dir);
  writeFileSync(join(dir, "client.mjs"), BRAIN_AGENT_CLIENT);
  writeFileSync(
    join(dir, "connection.json"),
    JSON.stringify({
      url: `http://127.0.0.1:${address.port}`,
      token: "test-machine-identity",
    }),
  );
  const output = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(process.execPath, [
      join(dir, "client.mjs"),
      "exec",
      "--secret",
      "TEST_KEY",
      "--repo",
      "alice/project",
      "--",
      process.execPath,
      "-e",
      'console.log(process.env.TEST_KEY === "private-value" ? "credential received" : "missing")',
    ]);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
  return { ...output, request, authorization };
}
it("passes requested values to a real child without printing them or changing parent environment", async () => {
  const before = process.env.TEST_KEY;
  const result = await run();
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("credential received\n");
  expect(result.stderr).toBe("");
  expect(result.request).toEqual({
    names: ["TEST_KEY"],
    repository: "alice/project",
  });
  expect(result.authorization).toBe("Bearer test-machine-identity");
  expect(process.env.TEST_KEY).toBe(before);
});
it("does not start the command when access is denied", async () => {
  const result = await run(403);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("403");
  expect(result.stderr).not.toContain("private-value");
});

it("keeps the MCP session and repository when forwarding real client messages", async () => {
  const received: Array<{
    headers: Record<string, unknown>;
    body: { method: string };
  }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    received.push({ headers: req.headers, body });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Mcp-Session-Id": "test-session",
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "initialize"
            ? { protocolVersion: "2025-11-25" }
            : { tools: [] },
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "kody-mcp-client-"));
  directories.push(dir);
  execFileSync("git", ["init", "--quiet", dir]);
  execFileSync("git", [
    "-C",
    dir,
    "remote",
    "add",
    "origin",
    "git@github.com:alice/project.git",
  ]);
  writeFileSync(join(dir, "client.mjs"), BRAIN_AGENT_CLIENT);
  writeFileSync(
    join(dir, "connection.json"),
    JSON.stringify({
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      token: "identity",
    }),
  );
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [join(dir, "client.mjs"), "mcp"], {
      cwd: dir,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("exit", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr)),
    );
    child.stdin.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
        "\n",
    );
  });
  expect(
    output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).id),
  ).toEqual([1, 2]);
  expect(received).toHaveLength(2);
  expect(received[1].headers).toMatchObject({
    "x-kody-agent-repository": "alice/project",
    "mcp-session-id": "test-session",
    "mcp-protocol-version": "2025-11-25",
    "mcp-method": "tools/list",
  });
});
