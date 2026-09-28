import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const backend = {
  query: vi.fn(),
  mutation: vi.fn(),
};

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: vi.fn(async () => ({
    auth: { owner: "acme", repo: "widgets", token: "github-pat" },
    actorLogin: "octocat",
    actorGithubId: 42,
  })),
}));

import {
  DELETE as mcpDELETE,
  GET as mcpGET,
  handleKodyMcpPost,
  POST as mcpPOST,
} from "../../app/api/kody/mcp/route";
import {
  listKodyActions,
  type KodyMcpActionServices,
} from "../../src/dashboard/lib/mcp/catalog";
import {
  DELETE as tokenDELETE,
  GET as tokenGET,
  POST as tokenPOST,
} from "../../app/api/kody/mcp/tokens/route";

const endpoint = "https://dash.test/api/kody/mcp";
const activeToken = {
  tokenId: "token-1",
  name: "Codex",
  tenantId: "acme/widgets",
  actorLogin: "octocat",
  actorGithubId: 42,
  scopes: ["mcp:read", "mcp:execute"],
  createdAt: "2026-09-02T08:00:00.000Z",
  expiresAt: "2026-10-02T08:00:00.000Z",
};
const phaseFourServices = {
  listMemories: vi.fn(),
  getMemory: vi.fn(),
  createMemory: vi.fn(),
  searchMemories: vi.fn(),
  getMemoryHistory: vi.fn(),
  reviseMemory: vi.fn(),
  retireMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listWork: vi.fn(),
  getWork: vi.fn(),
  createWork: vi.fn(),
  appendWork: vi.fn(),
  listPolicies: vi.fn(),
  getPolicy: vi.fn(),
  getInstructions: vi.fn(),
  listCapabilities: vi.fn(),
  getCapability: vi.fn(),
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  getQualityGates: vi.fn(),
  listApprovals: vi.fn(),
  getApproval: vi.fn(),
  requestWorkflowRun: vi.fn(),
  requestWorkflowResume: vi.fn(),
  requestCapabilityRun: vi.fn(),
  listSchedules: vi.fn(),
  getSchedule: vi.fn(),
  listTriggers: vi.fn(),
  getTrigger: vi.fn(),
  getWebhookStatus: vi.fn(),
  listNotificationRules: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getUsage: vi.fn(),
  requestScheduleSave: vi.fn(),
  requestScheduleDelete: vi.fn(),
  requestTriggerSave: vi.fn(),
  requestTriggerDelete: vi.fn(),
  requestWebhookReconcile: vi.fn(),
  requestNotificationRuleCreate: vi.fn(),
  requestNotificationRuleDelete: vi.fn(),
} satisfies KodyMcpActionServices;

function request(
  body: unknown,
  bearer = "kody_mcp_0123456789012345678901234567890123456789012",
) {
  return new NextRequest(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.query.mockResolvedValue(activeToken);
  backend.mutation.mockResolvedValue(true);
});

describe("public Kody MCP endpoint", () => {
  it("requires a header bearer and never accepts a query credential", async () => {
    expect((await mcpPOST(request({ id: 1, method: "ping" }, ""))).status).toBe(
      401,
    );
    const queryCredential = new NextRequest(`${endpoint}?token=secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect((await mcpPOST(queryCredential)).status).toBe(401);
  });

  it("accepts any standards-compliant client and exposes the stable facade", async () => {
    for (const name of ["generic-coding-agent", "future-agent-2030"]) {
      const initialized = await mcpPOST(
        request({
          jsonrpc: "2.0",
          id: `initialize-${name}`,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name, version: "compatibility-fixture" },
          },
        }),
      );
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get("mcp-session-id")).toMatch(/^run-/);
      await expect(initialized.json()).resolves.toMatchObject({
        result: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "kody" },
          capabilities: { tools: { listChanged: false } },
        },
      });
    }

    const listed = await mcpPOST(
      request({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const body = await listed.json();
    expect(
      body.result.tools.map((tool: { name: string }) => tool.name),
    ).toEqual([
      "kody_status",
      "kody_search_tools",
      "kody_get_tool_details",
      "kody_read_tool",
      "kody_execute_tool",
    ]);
    for (const tool of body.result.tools as Array<{
      name: string;
      outputSchema?: { type?: string };
    }>) {
      if (tool.outputSchema)
        expect(tool.outputSchema.type, tool.name).toBe("object");
    }
    expect(
      body.result.tools.find(
        (tool: { name: string }) => tool.name === "kody_execute_tool",
      ).outputSchema,
    ).toBeUndefined();
  });

  it("advertises a genuinely read-only execution path", async () => {
    const response = await mcpPOST(
      request({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const { result } = await response.json();
    expect(
      result.tools.find(
        (tool: { name: string }) => tool.name === "kody_read_tool",
      ),
    ).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(
      result.tools.find(
        (tool: { name: string }) => tool.name === "kody_execute_tool",
      ),
    ).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
    backend.query.mockResolvedValue({ ...activeToken, scopes: ["mcp:read"] });
    phaseFourServices.listWork.mockResolvedValueOnce([
      { recordId: "existing-work" },
    ]);
    const read = await handleKodyMcpPost(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "kody_read_tool",
          arguments: { actionId: "work.list", input: {} },
        },
      }),
      { services: phaseFourServices },
    );
    expect((await read.json()).result).toMatchObject({
      isError: false,
      structuredContent: [{ recordId: "existing-work" }],
    });
  });

  it("rejects every mutating catalog action on the read path even with execute scope", async () => {
    for (const action of listKodyActions().filter(
      (action) => action.permission !== "read",
    )) {
      const response = await handleKodyMcpPost(
        request({
          jsonrpc: "2.0",
          id: action.id,
          method: "tools/call",
          params: {
            name: "kody_read_tool",
            arguments: {
              actionId: action.id,
              input: action.examples[0]?.input ?? {},
            },
          },
        }),
        { services: phaseFourServices },
      );
      expect((await response.json()).result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "read_only_action_required" } },
      });
    }
    for (const service of Object.values(phaseFourServices))
      expect(service).not.toHaveBeenCalled();
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: "rejected",
        toolName: "kody_read_tool",
      }),
    );
  });

  it("ranks multiword discovery and explains the catalog boundary and empty results", async () => {
    async function search(args: Record<string, unknown>) {
      const response = await mcpPOST(
        request({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "kody_search_tools", arguments: args },
        }),
      );
      return (await response.json()).result.structuredContent;
    }
    const forward = await search({
      query: "workflow run inspect execution logs",
    });
    const reverse = await search({
      query: "logs execution inspect run workflow",
    });
    expect(forward.items.length).toBeGreaterThan(0);
    expect(reverse.items).toEqual(forward.items);
    expect((await search({ query: "workflow.list" })).items[0]).toMatchObject({
      id: "workflow.list",
      callTool: "kody_read_tool",
    });
    const categoryResults = await search({
      query: "workflows",
      category: "workflows",
    });
    expect(categoryResults.items.length).toBeGreaterThan(0);
    expect(
      categoryResults.items.every(
        (item: { category: string }) => item.category === "workflows",
      ),
    ).toBe(true);
    const firstPage = await search({ query: "workflow", limit: 1 });
    const secondPage = await search({
      query: "workflow",
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const together = await search({ query: "workflow", limit: 2 });
    expect([...firstPage.items, ...secondPage.items]).toEqual(together.items);
    expect(
      (await search({ cursor: Buffer.from("-1").toString("base64url") })).error
        .code,
    ).toBe("invalid_cursor");
    const empty = await search({ query: "zzzznomatch" });
    expect(empty.items).toEqual([]);
    expect(empty.guidance).toContain("empty query");
    expect(empty.guidance).toContain("resource");
    expect(empty.categories.length).toBeGreaterThan(0);
  });

  it("echoes a supported legacy protocol version during negotiation", async () => {
    const initialized = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: "legacy-initialize",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "generic-agent", version: "1.0.0" },
        },
      }),
    );

    await expect(initialized.json()).resolves.toMatchObject({
      result: { protocolVersion: "2025-06-18" },
    });
  });

  it("supports the current stateless protocol without an agent allowlist", async () => {
    const current = request({
      jsonrpc: "2.0",
      id: "current-tools",
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "unknown-standards-client",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    current.headers.set("mcp-protocol-version", "2026-07-28");
    current.headers.set("mcp-method", "tools/list");

    const response = await mcpPOST(current);
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      result: {
        resultType: "complete",
        cacheScope: "private",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "kody_status" }),
        ]),
      },
    });
  });

  it("rejects current-protocol routing headers that disagree with the body", async () => {
    const current = request({
      jsonrpc: "2.0",
      id: "mismatched-method",
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "generic-agent",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    current.headers.set("mcp-protocol-version", "2026-07-28");
    current.headers.set("mcp-method", "tools/call");

    const response = await mcpPOST(current);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: -32020 },
    });
  });

  it("rejects unsupported protocol headers", async () => {
    const req = request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    req.headers.set("mcp-protocol-version", "2099-01-01");
    expect((await mcpPOST(req)).status).toBe(400);
  });

  it("discovers details and executes a scoped catalog action", async () => {
    const search = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "kody_search_tools",
          arguments: { query: "scope", limit: 10 },
        },
      }),
    );
    const searchResult = (await search.json()).result.structuredContent;
    expect(searchResult.items).toContainEqual(
      expect.objectContaining({ id: "repository.scope.get" }),
    );

    const execute = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: { actionId: "repository.scope.get", input: {} },
        },
      }),
    );
    await expect(execute.json()).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          repository: "acme/widgets",
          actor: "octocat",
        },
      },
    });
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/widgets",
        agentName: "Codex",
        runId: expect.stringMatching(/^run-/),
        actionId: "repository.scope.get",
        outcome: "success",
      }),
    );
    const recorded = backend.mutation.mock.calls.find(
      ([, input]) => input.actionId === "repository.scope.get",
    )?.[1];
    expect(JSON.stringify(recorded)).not.toMatch(
      /arguments|structuredContent|prompt|transcript/,
    );
  });

  it("executes memory lifecycle actions through the same MCP facade", async () => {
    phaseFourServices.createMemory.mockResolvedValue({
      memory: { id: "memory-1", currentRevisionId: "revision-1" },
    });
    const response = await handleKodyMcpPost(
      request({
        jsonrpc: "2.0",
        id: "memory-create",
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: {
            actionId: "memory.create",
            idempotencyKey: "memory-create-1",
            input: {
              scope: "repository",
              kind: "decision",
              title: "MCP memory",
              summary: "Agents share durable context.",
              body: "Persist important decisions in Kody memory.",
            },
          },
        },
      }),
      { services: phaseFourServices },
    );
    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: { memory: { id: "memory-1" } },
      },
    });
    expect(phaseFourServices.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "memory-create-1",
        scope: "repository",
      }),
      expect.objectContaining({ tenantId: "acme/widgets" }),
    );
  });

  it("returns scoped status and full action details", async () => {
    const status = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "kody_status",
          arguments: {},
          _meta: { progressToken: "codex-call" },
        },
      }),
    );
    await expect(status.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          status: "ready",
          repository: "acme/widgets",
          actor: "octocat",
          grantedScopes: ["mcp:read", "mcp:execute"],
        },
      },
    });

    const details = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "kody_get_tool_details",
          arguments: { actionId: "mcp.contract.get" },
        },
      }),
    );
    await expect(details.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          id: "mcp.contract.get",
          permission: "read",
          approval: "none",
        },
      },
    });
  });

  it("supports Streamable HTTP notifications and an authenticated SSE GET", async () => {
    const notification = await mcpPOST(
      request({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(notification.status).toBe(202);

    const bearer = "kody_mcp_0123456789012345678901234567890123456789012";
    const stream = await mcpGET(
      new NextRequest(endpoint, {
        headers: { authorization: `Bearer ${bearer}` },
      }),
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");

    const deleted = await mcpDELETE(
      new NextRequest(endpoint, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${bearer}`,
          "mcp-session-id": "run-token-1-session-12345678",
        },
      }),
    );
    expect(deleted.status).toBe(204);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/widgets",
        runId: "run-token-1-session-12345678",
        status: "completed",
      }),
    );
  });

  it("rejects a session created by another token", async () => {
    const response = await mcpPOST(
      new NextRequest(endpoint, {
        method: "POST",
        headers: {
          authorization:
            "Bearer kody_mcp_0123456789012345678901234567890123456789012",
          "content-type": "application/json",
          "mcp-session-id": "run-another-token-session-12345678",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_session",
    });
  });

  it("returns safe protocol and tool errors", async () => {
    const unknownMethod = await mcpPOST(
      request({ jsonrpc: "2.0", id: 7, method: "not/a/method" }),
    );
    await expect(unknownMethod.json()).resolves.toMatchObject({
      error: { code: -32601, message: "Method not found" },
    });

    const unknownAction = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: { actionId: "not.an.action", input: {} },
        },
      }),
    );
    await expect(unknownAction.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "action_not_found" } },
      },
    });

    const badContent = request({ jsonrpc: "2.0", id: 9, method: "ping" });
    badContent.headers.set("content-type", "text/plain");
    expect((await mcpPOST(badContent)).status).toBe(415);
  });

  it("lets read-only tokens execute read actions but rejects writes", async () => {
    backend.query.mockResolvedValue({
      ...activeToken,
      scopes: ["mcp:read"],
    });

    const read = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: "read-only-read",
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: { actionId: "repository.scope.get", input: {} },
        },
      }),
    );
    await expect(read.json()).resolves.toMatchObject({
      result: { isError: false },
    });

    const write = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: "read-only-write",
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: {
            actionId: "work.create",
            idempotencyKey: "read-only-write",
            input: {
              recordId: "read-only",
              title: "Read only",
              objective: "Must not write",
            },
          },
        },
      }),
    );
    await expect(write.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "insufficient_scope" } },
      },
    });
  });

  it("returns safe field-level validation guidance", async () => {
    const response = await mcpPOST(
      request({
        jsonrpc: "2.0",
        id: "invalid-action-input",
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: {
            actionId: "work.get",
            input: { recordId: "not a valid id" },
          },
        },
      }),
    );
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toMatchObject({
      code: "invalid_input",
      issues: [expect.objectContaining({ path: "recordId" })],
    });
    expect(JSON.stringify(body)).not.toMatch(/stack|tokenHash|kody_mcp_/i);
  });

  it("does not silently report a write as successful when auditing fails", async () => {
    phaseFourServices.createWork.mockResolvedValueOnce({
      recordId: "audit-required",
      revision: 1,
    });
    backend.mutation
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await handleKodyMcpPost(
      request({
        jsonrpc: "2.0",
        id: "audit-required",
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: {
            actionId: "work.create",
            idempotencyKey: "audit-required",
            input: {
              recordId: "audit-required",
              title: "Audit required",
              objective: "Never hide missing audit records",
            },
          },
        },
      }),
      { services: phaseFourServices },
    );

    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: "audit_unavailable" } },
      },
    });
  });

  it("routes approved Phase 4 requests through injected Kody services", async () => {
    phaseFourServices.requestWorkflowRun.mockResolvedValueOnce({
      requestId: "request-1",
      status: "pending",
      workflowId: "quality-run",
      runId: "run-1",
    });
    const response = await handleKodyMcpPost(
      request({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "kody_execute_tool",
          arguments: {
            actionId: "workflow.run.request",
            idempotencyKey: "request-quality-run",
            input: {
              workflowId: "quality-run",
              workRecordId: "phase-4",
              input: {},
            },
          },
        },
      }),
      { services: phaseFourServices },
    );
    await expect(response.json()).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: { requestId: "request-1", status: "pending" },
      },
    });
    expect(phaseFourServices.requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "request-quality-run" }),
      expect.objectContaining({ tenantId: "acme/widgets" }),
    );
  });

  it("rejects expired or revoked tokens, invalid origins, and excess requests", async () => {
    backend.query.mockResolvedValueOnce(null);
    expect(
      (await mcpPOST(request({ jsonrpc: "2.0", id: 1, method: "ping" })))
        .status,
    ).toBe(401);

    const foreignOrigin = request({ jsonrpc: "2.0", id: 2, method: "ping" });
    foreignOrigin.headers.set("origin", "https://evil.test");
    expect((await mcpPOST(foreignOrigin)).status).toBe(403);

    backend.mutation.mockResolvedValueOnce(false);
    expect(
      (await mcpPOST(request({ jsonrpc: "2.0", id: 3, method: "ping" })))
        .status,
    ).toBe(429);
  });

  it("accepts a browser request whose Origin matches the forwarded request host", async () => {
    const sameOrigin = request({ jsonrpc: "2.0", id: 4, method: "ping" });
    sameOrigin.headers.set("origin", "http://127.0.0.1:3333");
    sameOrigin.headers.set("host", "127.0.0.1:3333");
    sameOrigin.headers.set("x-forwarded-proto", "http");

    expect((await mcpPOST(sameOrigin)).status).toBe(200);

    const wrongScheme = request({ jsonrpc: "2.0", id: 5, method: "ping" });
    wrongScheme.headers.set("origin", "http://dash.test");
    wrongScheme.headers.set("host", "dash.test");
    wrongScheme.headers.set("x-forwarded-proto", "https");
    expect((await mcpPOST(wrongScheme)).status).toBe(403);
  });

  it("fails closed as rate limited when concurrent counter updates conflict", async () => {
    backend.mutation.mockRejectedValueOnce(
      new Error("OptimisticConcurrencyControlFailure"),
    );
    const response = await mcpPOST(
      request({ jsonrpc: "2.0", id: 10, method: "ping" }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});

describe("MCP access-token issuance", () => {
  it.each(["read", "execute"])(
    "issues project-only %s access without personal or deletion grants",
    async (access) => {
      const response = await tokenPOST(
        new NextRequest(`${endpoint}/tokens`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kody-token": "github-pat",
            "x-kody-owner": "acme",
            "x-kody-repo": "widgets",
          },
          body: JSON.stringify({
            name: "Project trial",
            access,
            memoryScope: "repository",
            allowMemoryDelete: false,
          }),
        }),
      );
      expect(response.status).toBe(201);
      expect(backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scopes:
            access === "read"
              ? ["mcp:read", "memory:repository:read"]
              : [
                  "mcp:read",
                  "mcp:execute",
                  "memory:repository:read",
                  "memory:repository:write",
                ],
        }),
      );
    },
  );

  it("rejects arbitrary memory scope names", async () => {
    const response = await tokenPOST(
      new NextRequest(`${endpoint}/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid scope",
          memoryScope: "another-account",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(backend.mutation).not.toHaveBeenCalled();
  });

  it("issues a repository-scoped expiring token and returns plaintext once", async () => {
    const req = new NextRequest(`${endpoint}/tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "github-pat",
        "x-kody-owner": "acme",
        "x-kody-repo": "widgets",
      },
      body: JSON.stringify({ name: "Claude Code", expiresInDays: 30 }),
    });
    const response = await tokenPOST(req);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.accessToken).toMatch(/^kody_mcp_/);
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/widgets",
        actorLogin: "octocat",
        name: "Claude Code",
        tokenHash: expect.not.stringContaining("kody_mcp_"),
      }),
    );
  });

  it("issues a least-privilege read-only token when requested", async () => {
    const req = new NextRequest(`${endpoint}/tokens`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kody-token": "github-pat",
        "x-kody-owner": "acme",
        "x-kody-repo": "widgets",
      },
      body: JSON.stringify({
        name: "Read-only agent",
        expiresInDays: 30,
        access: "read",
      }),
    });

    expect((await tokenPOST(req)).status).toBe(201);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopes: ["mcp:read", "memory:personal:read", "memory:repository:read"],
      }),
    );
  });

  it("lists metadata without hashes and revokes only a scoped caller token", async () => {
    backend.query.mockResolvedValueOnce([
      { ...activeToken, revokedAt: undefined },
    ]);
    const headers = {
      "content-type": "application/json",
      "x-kody-token": "github-pat",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    };
    const listed = await tokenGET(
      new NextRequest(`${endpoint}/tokens`, { headers }),
    );
    const listBody = await listed.json();
    expect(listBody.tokens).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain("tokenHash");

    backend.mutation.mockResolvedValueOnce(true);
    const revoked = await tokenDELETE(
      new NextRequest(`${endpoint}/tokens`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ tokenId: crypto.randomUUID() }),
      }),
    );
    expect(revoked.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "acme/widgets",
        actorLogin: "octocat",
      }),
    );
  });
});
