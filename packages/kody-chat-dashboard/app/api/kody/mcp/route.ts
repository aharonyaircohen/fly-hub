import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { logger } from "@kody-ade/base/logger";
import {
  KODY_MCP_CONTRACT_VERSION,
  KODY_MCP_LEGACY_PROTOCOL_VERSION,
  KODY_MCP_PROTOCOL_VERSION,
  KODY_MCP_SERVER_VERSION,
  mcpPrincipalSchema,
  scopeForPrincipal,
  toJsonSchema,
  type McpPrincipal,
} from "../../../../src/dashboard/lib/mcp/contracts";
import {
  executeKodyAction,
  getKodyAction,
  KodyActionError,
  listKodyActions,
  isReadOnlyAction,
  searchKodyActions,
  type KodyMcpActionServices,
} from "../../../../src/dashboard/lib/mcp/catalog";
import {
  hashMcpAccessToken,
  isMcpAccessToken,
} from "../../../../src/dashboard/lib/mcp/access-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT_PER_MINUTE = 120;
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-03-26",
  "2025-06-18",
  KODY_MCP_LEGACY_PROTOCOL_VERSION,
  KODY_MCP_PROTOCOL_VERSION,
]);
const CURRENT_PROTOCOL_VERSION = KODY_MCP_PROTOCOL_VERSION;
const SERVER_INSTRUCTIONS =
  "Kody is repository-scoped and client-agnostic. Check kody_status first. " +
  "Use kody_search_tools to find an action, kody_get_tool_details to inspect " +
  "its exact schema and permissions. Call kody_read_tool with {actionId, input} " +
  "for read actions; use kody_execute_tool for changes with an idempotencyKey. " +
  "Search finds action definitions, not resource contents: use discovered list/get actions to inspect actual work, workflows, runs, or durable memory. " +
  "Memory writes include revision history and require the latest expectedRevisionId for corrections or retirement.";
const FACADE_TOOL_NAMES = [
  "kody_status",
  "kody_search_tools",
  "kody_get_tool_details",
  "kody_read_tool",
  "kody_execute_tool",
] as const;

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

const searchInput = z
  .object({
    query: z.string().trim().max(200).optional(),
    category: z.string().trim().max(80).optional(),
    cursor: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
const detailsInput = z
  .object({ actionId: z.string().min(1).max(160) })
  .strict();
const executeInput = z
  .object({
    actionId: z.string().min(1).max(160),
    input: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .strict();
const readInput = executeInput.omit({ idempotencyKey: true });

const facadeTools = [
  {
    name: "kody_status",
    title: "Kody status",
    description:
      "Get Kody MCP version, authenticated scope, and safe health data.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "kody_search_tools",
    title: "Search Kody actions",
    description:
      "Find action definitions by words in their ID, title, category, or summary, ranked by relevance. This does not search resource contents; use list/get actions to inspect actual resources. Empty query lists the catalog.",
    inputSchema: toJsonSchema(searchInput),
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "kody_get_tool_details",
    title: "Get Kody action details",
    description:
      "Get the full schema, permissions, side effects, approval policy, and examples for one action.",
    inputSchema: toJsonSchema(detailsInput),
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "kody_read_tool",
    title: "Read Kody data",
    description:
      "Run a discovered read-only action using {actionId, input}. Get its exact input schema with kody_get_tool_details first. Cannot change product data or create approval requests, regardless of token scope.",
    inputSchema: toJsonSchema(readInput),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "kody_execute_tool",
    title: "Execute a Kody action",
    description:
      "Execute a discovered write or approval action using {actionId, input, idempotencyKey}. Follow its permission and approval policy. Use kody_read_tool for reads; legacy read calls here remain supported but clients may require approval for this tool.",
    inputSchema: toJsonSchema(executeInput),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "invalid_token" },
    {
      status: 401,
      headers: {
        ...NO_STORE_HEADERS,
        "WWW-Authenticate": 'Bearer realm="Kody MCP"',
      },
    },
  );
}

function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const configured = (process.env.KODY_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (origin === req.nextUrl.origin || configured.includes(origin)) return true;
  try {
    const protocol =
      req.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() ||
      req.nextUrl.protocol.replace(/:$/, "");
    const requestHosts = [
      req.headers.get("host"),
      req.headers.get("x-forwarded-host"),
    ]
      .filter((host): host is string => Boolean(host))
      .map((host) => host.toLowerCase());
    return requestHosts.some(
      (host) => origin.toLowerCase() === `${protocol}://${host}`,
    );
  } catch {
    return false;
  }
}

async function authenticate(
  req: NextRequest,
): Promise<McpPrincipal | NextResponse> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return unauthorized();
  const token = authorization.slice("bearer ".length).trim();
  if (!isMcpAccessToken(token)) return unauthorized();
  try {
    const backend = createBackendClient();
    const row = await backend.query(backendApi.mcpAccessTokens.authenticate, {
      tokenHash: hashMcpAccessToken(token),
      now: new Date().toISOString(),
    });
    const parsed = mcpPrincipalSchema.safeParse(row);
    if (!parsed.success) return unauthorized();
    const allowed = await checkRateLimit(backend, parsed.data.tokenId);
    if (!allowed)
      return NextResponse.json(
        { error: "rate_limit_exceeded" },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, "Retry-After": "60" },
        },
      );
    return parsed.data;
  } catch (error) {
    logger.error({ err: error }, "public mcp authentication failed");
    return NextResponse.json(
      { error: "mcp_authentication_unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

async function checkRateLimit(
  backend: ReturnType<typeof createBackendClient>,
  tokenId: string,
): Promise<boolean> {
  try {
    return await backend.mutation(backendApi.mcpRateLimits.check, {
      key: tokenId,
      now: Math.floor(Date.now() / 1000),
      windowSec: 60,
      limit: RATE_LIMIT_PER_MINUTE,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("OptimisticConcurrencyControlFailure")
    )
      return false;
    throw error;
  }
}

export async function GET(req: NextRequest) {
  if (!originAllowed(req))
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  const principal = await authenticate(req);
  if (principal instanceof NextResponse) return principal;
  return new NextResponse(": kody-mcp\n\n", {
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const principal = await authenticate(req);
  if (principal instanceof NextResponse) return principal;
  const runId = validatedRunId(req.headers.get("mcp-session-id"));
  if (!runId || !runBelongsToPrincipal(runId, principal))
    return NextResponse.json(
      { error: "invalid_session" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  await createBackendClient().mutation(backendApi.agentRuns.finish, {
    tenantId: principal.tenantId,
    runId,
    status: "completed",
    endedAt: new Date().toISOString(),
  });
  return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  return await handleKodyMcpPost(req);
}

export async function handleKodyMcpPost(
  req: NextRequest,
  options: {
    services?: KodyMcpActionServices;
    /** Trusted host adapter; public callers cannot supply a principal. */
    authenticate?: (req: NextRequest) => Promise<McpPrincipal | NextResponse>;
  } = {},
) {
  if (!originAllowed(req))
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  const principal = await (options.authenticate ?? authenticate)(req);
  if (principal instanceof NextResponse) return principal;
  const suppliedRunId = req.headers.get("mcp-session-id");
  if (
    suppliedRunId &&
    (!validatedRunId(suppliedRunId) ||
      !runBelongsToPrincipal(suppliedRunId, principal))
  )
    return NextResponse.json(
      { error: "invalid_session" },
      { status: 400, headers: NO_STORE_HEADERS },
    );

  if (
    (req.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json"
  )
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415, headers: NO_STORE_HEADERS },
    );
  const requestedProtocol = req.headers.get("mcp-protocol-version");
  if (requestedProtocol && !SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol))
    return NextResponse.json(
      { error: "unsupported_protocol_version" },
      { status: 400, headers: NO_STORE_HEADERS },
    );

  const declaredSize = Number(req.headers.get("content-length") ?? "0");
  if (declaredSize > MAX_BODY_BYTES)
    return NextResponse.json(
      { error: "request_too_large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );

  let body: JsonRpcRequest | null = null;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES)
      return NextResponse.json(
        { error: "request_too_large" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    body = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return jsonRpcError(null, -32600, "Invalid Request");
  if (!("id" in body))
    return new NextResponse(null, { status: 202, headers: NO_STORE_HEADERS });
  if (body.jsonrpc !== "2.0")
    return jsonRpcError(body.id ?? null, -32600, "Invalid Request");

  const currentProtocol = requestedProtocol === CURRENT_PROTOCOL_VERSION;
  if (currentProtocol) {
    const protocolError = validateCurrentProtocolRequest(req, body);
    if (protocolError) return protocolError;
  }

  if (body.method === "initialize") {
    const initialization = z
      .object({
        protocolVersion: z.string(),
        capabilities: z.record(z.string(), z.unknown()),
        clientInfo: z.object({
          name: z.string().trim().min(1).max(120),
          version: z.string().trim().min(1).max(120),
        }),
      })
      .passthrough()
      .safeParse(body.params);
    if (!initialization.success)
      return jsonRpcError(
        body.id ?? null,
        -32602,
        "Invalid initialize parameters",
      );
    const negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.has(
      initialization.data.protocolVersion,
    )
      ? initialization.data.protocolVersion
      : KODY_MCP_LEGACY_PROTOCOL_VERSION;
    const runId = `run-${principal.tokenId}-${crypto.randomUUID()}`;
    await beginAgentRun(principal, runId, initialization.data.clientInfo.name);
    return jsonRpcResult(
      body.id ?? null,
      {
        protocolVersion: negotiatedVersion,
        serverInfo: {
          name: "kody",
          version: KODY_MCP_SERVER_VERSION,
          description: "Shared Kody extensions for coding agents",
        },
        capabilities: { tools: { listChanged: false } },
        instructions: SERVER_INSTRUCTIONS,
      },
      { "Mcp-Session-Id": runId },
    );
  }
  if (body.method === "server/discover")
    return jsonRpcResult(body.id ?? null, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      serverInfo: serverInfo(),
      capabilities: { tools: { listChanged: false } },
      instructions: SERVER_INSTRUCTIONS,
    });
  if (body.method === "ping") return jsonRpcResult(body.id ?? null, {});
  if (body.method === "tools/list")
    return jsonRpcResult(body.id ?? null, {
      ...(currentProtocol
        ? { resultType: "complete", ttlMs: 300_000, cacheScope: "private" }
        : {}),
      tools: facadeTools,
    });
  if (body.method === "tools/call")
    return await callFacadeTool(
      body.id ?? null,
      body.params,
      principal,
      requestRunId(req, principal),
      options.services,
      currentProtocol,
    );
  return jsonRpcError(body.id ?? null, -32601, "Method not found");
}

async function callFacadeTool(
  id: JsonRpcId,
  params: unknown,
  principal: McpPrincipal,
  runId: string,
  services?: KodyMcpActionServices,
  currentProtocol = false,
): Promise<NextResponse> {
  const payload = z
    .object({
      name: z.enum(FACADE_TOOL_NAMES),
      arguments: z.record(z.string(), z.unknown()).optional(),
      _meta: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .safeParse(params);
  if (!payload.success)
    return jsonRpcError(id, -32602, "Invalid tools/call parameters");
  const args = payload.data.arguments ?? {};
  let outcome: "success" | "rejected" | "error" = "success";
  let actionId: string | undefined;
  let workRecordId: string | undefined;
  try {
    let result: unknown;
    switch (payload.data.name) {
      case "kody_status":
        result = {
          status: "ready",
          protocolVersion: KODY_MCP_PROTOCOL_VERSION,
          contractVersion: KODY_MCP_CONTRACT_VERSION,
          repository: principal.tenantId,
          actor: principal.actorLogin,
          tokenExpiresAt: principal.expiresAt,
          scope: scopeForPrincipal(principal),
          grantedScopes: principal.scopes,
          facadeTools: FACADE_TOOL_NAMES,
        };
        break;
      case "kody_search_tools": {
        const parsed = searchInput.parse(args);
        const offset = decodeCursor(parsed.cursor);
        const matches = searchKodyActions(parsed.query, parsed.category);
        const items = matches
          .slice(offset, offset + parsed.limit)
          .map((action) => ({
            id: action.id,
            title: action.title,
            summary: action.summary,
            category: action.category,
            permission: action.permission,
            callTool: isReadOnlyAction(action)
              ? "kody_read_tool"
              : "kody_execute_tool",
          }));
        result = {
          items,
          categories: [
            ...new Set(listKodyActions().map((action) => action.category)),
          ].sort(),
          guidance:
            "These are action definitions, not resource search results. Inspect an action's schema, then call its list/get operation to read actual resources. If nothing matches, use an empty query or a listed category.",
          ...(offset + items.length < matches.length
            ? { nextCursor: encodeCursor(offset + items.length) }
            : {}),
        };
        break;
      }
      case "kody_get_tool_details": {
        const parsed = detailsInput.parse(args);
        actionId = parsed.actionId;
        const action = getKodyAction(actionId);
        if (!action)
          throw new KodyActionError("action_not_found", "Unknown action.");
        result = {
          ...action,
          callTool: isReadOnlyAction(action)
            ? "kody_read_tool"
            : "kody_execute_tool",
        };
        break;
      }
      case "kody_read_tool":
      case "kody_execute_tool": {
        const readOnly = payload.data.name === "kody_read_tool";
        const parsed = readOnly
          ? { ...readInput.parse(args), idempotencyKey: undefined }
          : executeInput.parse(args);
        actionId = parsed.actionId;
        workRecordId = linkedWorkRecordId(parsed.input);
        const action = getKodyAction(actionId);
        if (
          !readOnly &&
          action &&
          action.permission !== "read" &&
          !parsed.idempotencyKey
        )
          throw new KodyActionError(
            "idempotency_key_required",
            "Write actions require an idempotency key.",
          );
        result = await executeKodyAction(actionId, parsed.input, principal, {
          idempotencyKey: parsed.idempotencyKey,
          services,
          readOnly,
        });
        break;
      }
    }
    const audited = await audit(
      principal,
      runId,
      payload.data.name,
      actionId,
      outcome,
      workRecordId,
    );
    const action = actionId ? getKodyAction(actionId) : null;
    if (action && action.permission !== "read" && !audited)
      return toolError(
        id,
        "audit_unavailable",
        "The action completed, but Kody could not record its audit event. Retry with the same idempotency key.",
        undefined,
        currentProtocol,
      );
    return toolResult(id, result, currentProtocol);
  } catch (error) {
    outcome =
      error instanceof KodyActionError || error instanceof z.ZodError
        ? "rejected"
        : "error";
    await audit(
      principal,
      runId,
      payload.data.name,
      actionId,
      outcome,
      workRecordId,
    );
    if (error instanceof KodyActionError)
      return toolError(
        id,
        error.code,
        error.message,
        error.details,
        currentProtocol,
      );
    if (error instanceof z.ZodError)
      return toolError(
        id,
        "invalid_input",
        "Tool input is invalid.",
        safeValidationIssues(error),
        currentProtocol,
      );
    logger.error({ err: error }, "public mcp tool call failed");
    return toolError(
      id,
      "internal_error",
      "Kody could not complete the action.",
      undefined,
      currentProtocol,
    );
  }
}

async function audit(
  principal: McpPrincipal,
  runId: string,
  toolName: string,
  actionId: string | undefined,
  outcome: "success" | "rejected" | "error",
  workRecordId?: string,
): Promise<boolean> {
  try {
    await createBackendClient().mutation(backendApi.agentRuns.recordCall, {
      eventId: crypto.randomUUID(),
      tenantId: principal.tenantId,
      runId,
      tokenId: principal.tokenId,
      agentName: principal.name,
      ...(workRecordId ? { workRecordId } : {}),
      method: "tools/call",
      toolName,
      ...(actionId ? { actionId } : {}),
      outcome,
      occurredAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    logger.error({ err: error }, "public mcp audit failed");
    return false;
  }
}

function serverInfo() {
  return {
    name: "kody",
    version: KODY_MCP_SERVER_VERSION,
    description: "Shared Kody extensions for any MCP coding agent",
  };
}

function validateCurrentProtocolRequest(
  req: NextRequest,
  body: JsonRpcRequest,
): NextResponse | null {
  const meta = z
    .object({
      "io.modelcontextprotocol/protocolVersion": z.literal(
        CURRENT_PROTOCOL_VERSION,
      ),
      "io.modelcontextprotocol/clientInfo": z.object({
        name: z.string().trim().min(1).max(120),
        version: z.string().trim().min(1).max(120),
      }),
      "io.modelcontextprotocol/clientCapabilities": z.record(
        z.string(),
        z.unknown(),
      ),
    })
    .passthrough()
    .safeParse(
      body.params && typeof body.params === "object"
        ? (body.params as Record<string, unknown>)._meta
        : undefined,
    );
  if (!meta.success)
    return jsonRpcError(
      body.id ?? null,
      -32602,
      "Current protocol metadata is required",
      400,
    );
  if (req.headers.get("mcp-method") !== body.method)
    return jsonRpcError(
      body.id ?? null,
      -32020,
      "MCP routing headers do not match the request",
      400,
    );
  const routedName = req.headers.get("mcp-name");
  const bodyName =
    body.method === "tools/call" &&
    body.params &&
    typeof body.params === "object" &&
    typeof (body.params as Record<string, unknown>).name === "string"
      ? String((body.params as Record<string, unknown>).name)
      : null;
  if (bodyName && routedName !== bodyName)
    return jsonRpcError(
      body.id ?? null,
      -32020,
      "MCP routing headers do not match the request",
      400,
    );
  return null;
}

function safeValidationIssues(error: z.ZodError) {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

async function beginAgentRun(
  principal: McpPrincipal,
  runId: string,
  clientName?: string,
) {
  try {
    await createBackendClient().mutation(backendApi.agentRuns.begin, {
      tenantId: principal.tenantId,
      runId,
      tokenId: principal.tokenId,
      agentName: principal.name,
      ...(clientName ? { clientName } : {}),
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "public mcp agent run start failed");
  }
}

function linkedWorkRecordId(
  input: Record<string, unknown>,
): string | undefined {
  const value = input.workRecordId ?? input.recordId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validatedRunId(value: string | null): string | undefined {
  if (!value || !/^run-[a-zA-Z0-9._-]{8,160}$/.test(value)) return undefined;
  return value;
}

function requestRunId(req: NextRequest, principal: McpPrincipal): string {
  const session = validatedRunId(req.headers.get("mcp-session-id"));
  if (session && runBelongsToPrincipal(session, principal)) return session;
  const bucket = Math.floor(Date.now() / (30 * 60 * 1_000));
  const digest = crypto
    .createHash("sha256")
    .update(`${principal.tenantId}:${principal.tokenId}:${bucket}`)
    .digest("hex")
    .slice(0, 24);
  return `run-rolling-${digest}`;
}

function runBelongsToPrincipal(
  runId: string,
  principal: McpPrincipal,
): boolean {
  return runId.startsWith(`run-${principal.tokenId}-`);
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(value) || value < 0)
    throw new KodyActionError(
      "invalid_cursor",
      "Pagination cursor is invalid.",
    );
  return value;
}

function toolResult(
  id: JsonRpcId,
  value: unknown,
  currentProtocol = false,
): NextResponse {
  return jsonRpcResult(id, {
    ...(currentProtocol ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: false,
  });
}

function toolError(
  id: JsonRpcId,
  code: string,
  message: string,
  issues?: Array<{ path: string; code: string; message: string }>,
  currentProtocol = false,
): NextResponse {
  const value = { error: { code, message, ...(issues ? { issues } : {}) } };
  return jsonRpcResult(id, {
    ...(currentProtocol ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: true,
  });
}

function jsonRpcResult(
  id: JsonRpcId,
  result: unknown,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: { ...NO_STORE_HEADERS, ...headers } },
  );
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: NO_STORE_HEADERS },
  );
}
