import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  issueFlyHubMcpGrant,
  readFlyHubMcpGrant,
} from "../../src/dashboard/lib/fly-hub-mcp-auth";
import { POST as issueToken } from "../../app/api/fly-hub/mcp-token/route";
import { POST as callMcp } from "../../app/api/fly-hub/mcp/route";
import { setHubSession } from "@kody-ade/fly/hub/session";
import { NextResponse } from "next/server";

vi.mock("@kody-ade/fly/infrastructure/server-machines", () => ({
  listServerProviderInventory: vi.fn(async () => ({
    machines: [
      { app: "flyhub-123", machineId: "m1", state: "started" },
      { app: "other-app", machineId: "m2", state: "started" },
    ],
  })),
  startServerProviderMachine: vi.fn(),
  suspendMachine: vi.fn(),
  destroyMachine: vi.fn(),
}));
vi.mock("@kody-ade/fly/machines/managed", () => ({
  managedMachineAppName: vi.fn(() => "flyhub-123"),
  createManagedMachine: vi.fn(async () => ({
    app: "flyhub-123",
    machineId: "m3",
  })),
}));
vi.mock("@kody-ade/fly/hub/app-source", () => ({
  inspectPublicGitHubApp: vi.fn(async () => ({
    repository: "acme/site",
    name: "site",
    appName: "flyhub-app-acme-site-123456789abc",
    commitSha: "a".repeat(40),
    branch: "main",
    plan: { kind: "node", rootDirectory: ".", port: 3000 },
    requiredSecretNames: [],
  })),
}));

const origin = "https://flyhub.example";
const originalKey = process.env.KODY_MASTER_KEY;

function mcpRequest(
  bearer: string | undefined,
  method: string,
  name?: string,
  args?: unknown,
) {
  return new NextRequest(`${origin}/api/fly-hub/mcp`, {
    method: "POST",
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(name ? { params: { name, arguments: args ?? {} } } : {}),
    }),
  });
}

describe("Fly Hub MCP", () => {
  beforeEach(() => {
    process.env.KODY_MASTER_KEY = "33".repeat(32);
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.KODY_MASTER_KEY;
    else process.env.KODY_MASTER_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("issues a short lived scoped bearer from a same-origin signed-in session", async () => {
    const sessionResponse = NextResponse.json({});
    setHubSession(sessionResponse, {
      token: "fly-secret",
      orgSlug: "personal",
    });
    const cookie = sessionResponse.cookies.get("fly_hub_session")!.value;
    const request = (requestOrigin: string) =>
      new NextRequest(`${origin}/api/fly-hub/mcp-token`, {
        method: "POST",
        headers: {
          origin: requestOrigin,
          host: "flyhub.example",
          "x-forwarded-proto": "https",
          cookie: `fly_hub_session=${cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ scopes: ["read", "command"] }),
      });
    expect((await issueToken(request("https://evil.example"))).status).toBe(
      403,
    );
    const issued = await issueToken(request(origin));
    expect(issued.status).toBe(200);
    const body = await issued.json();
    expect(body.bearerToken).not.toContain("fly-secret");
    expect(readFlyHubMcpGrant(`Bearer ${body.bearerToken}`)).toMatchObject({
      orgSlug: "personal",
      scopes: ["read", "command"],
    });
  });

  it("inspects an app repository through a read-scoped chat credential", async () => {
    const read = issueFlyHubMcpGrant({
      token: "fly-secret",
      orgSlug: "personal",
      scopes: ["read"],
    }).bearerToken;
    const result = await (
      await callMcp(
        mcpRequest(read, "tools/call", "flyhub_inspect_app", {
          url: "https://github.com/acme/site",
        }),
      )
    ).json();
    expect(result.result.structuredContent).toMatchObject({
      repository: "acme/site",
      commitSha: "a".repeat(40),
    });
    expect(JSON.stringify(result)).not.toContain("fly-secret");
  });

  it("enforces scopes, ownership, confirmation, and keeps Fly credentials out of results", async () => {
    const flyFetch = vi.fn();
    vi.stubGlobal("fetch", flyFetch);
    const read = issueFlyHubMcpGrant({
      token: "fly-secret",
      orgSlug: "personal",
      scopes: ["read"],
    }).bearerToken;
    expect((await callMcp(mcpRequest(undefined, "tools/list"))).status).toBe(
      401,
    );
    const list = await (await callMcp(mcpRequest(read, "tools/list"))).json();
    expect(
      list.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "flyhub_list_apps",
      "flyhub_app_status",
      "flyhub_inspect_app",
      "flyhub_list_machines",
      "flyhub_get_machine",
    ]);
    const machines = await (
      await callMcp(mcpRequest(read, "tools/call", "flyhub_list_machines"))
    ).json();
    expect(JSON.stringify(machines)).not.toContain("other-app");
    expect(JSON.stringify(machines)).not.toContain("fly-secret");
    const denied = await (
      await callMcp(
        mcpRequest(read, "tools/call", "flyhub_run_command", {
          app: "flyhub-123",
          machineId: "m1",
          command: "pwd",
          confirm: true,
        }),
      )
    ).json();
    expect(denied.result.isError).toBe(true);

    const command = issueFlyHubMcpGrant({
      token: "fly-secret",
      orgSlug: "personal",
      scopes: ["command"],
    }).bearerToken;
    const unconfirmed = await (
      await callMcp(
        mcpRequest(command, "tools/call", "flyhub_run_command", {
          app: "flyhub-123",
          machineId: "m1",
          command: "pwd",
        }),
      )
    ).json();
    expect(unconfirmed.result.isError).toBe(true);
    const outside = await (
      await callMcp(
        mcpRequest(command, "tools/call", "flyhub_run_command", {
          app: "other-app",
          machineId: "m2",
          command: "pwd",
          confirm: true,
        }),
      )
    ).json();
    expect(outside.result.isError).toBe(true);
    expect(flyFetch).not.toHaveBeenCalled();
  });

  it("runs a bounded command through the Fly Machines API", async () => {
    const token = issueFlyHubMcpGrant({
      token: "fly-secret",
      orgSlug: "personal",
      scopes: ["command"],
    }).bearerToken;
    const flyFetch = vi.fn(async () =>
      Response.json({ stdout: "ok", stderr: "", exit_code: 0 }),
    );
    vi.stubGlobal("fetch", flyFetch);
    const result = await (
      await callMcp(
        mcpRequest(token, "tools/call", "flyhub_run_command", {
          app: "flyhub-123",
          machineId: "m1",
          command: "pwd",
          confirm: true,
        }),
      )
    ).json();
    expect(result.result.structuredContent).toMatchObject({
      exitCode: 0,
      stdout: { text: "ok", truncated: false },
    });
    expect(flyFetch).toHaveBeenCalledWith(
      expect.stringContaining("/apps/flyhub-123/machines/m1/exec"),
      expect.objectContaining({
        body: JSON.stringify({
          command: ["/bin/sh", "-lc", "pwd"],
          timeout: 15,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("fly-secret");
  });

  it("supports current stateless MCP discovery and validates routing headers", async () => {
    const token = issueFlyHubMcpGrant({
      token: "fly-secret",
      orgSlug: "personal",
      scopes: ["read"],
    }).bearerToken;
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const request = (methodHeader: string) =>
      new NextRequest(`${origin}/api/fly-hub/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": methodHeader,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: { _meta: meta },
        }),
      });
    expect((await callMcp(request("tools/list"))).status).toBe(400);
    const discovered = await (await callMcp(request("server/discover"))).json();
    expect(discovered.result.protocolVersion).toBe("2026-07-28");
  });
});
