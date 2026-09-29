import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setHubSession } from "@kody-ade/fly/hub/session";
import { GET as listHubApps, POST as deployHubApp } from "../apps/route";
import { POST as inspectHubApp } from "../apps/inspect/route";
import { POST as resetHubAppPassword } from "../apps/[app]/password/route";
import {
  readFlyHubMcpGrant,
  type FlyHubMcpGrant,
} from "@dashboard/lib/fly-hub-mcp-auth";
import {
  readFlyHubEveTask,
  type FlyHubEveTask,
} from "@dashboard/lib/fly-hub-eve-task";
import { taskBuildSchema } from "@dashboard/lib/fly-hub-task-build";
import {
  flyHubAppName,
  inspectPublicGitHubApp,
} from "@kody-ade/fly/hub/app-source";
import {
  createManagedMachine,
  managedMachineAppName,
} from "@kody-ade/fly/machines/managed";
import {
  destroyMachine,
  listServerProviderInventory,
  startServerProviderMachine,
  suspendMachine,
} from "@kody-ade/fly/infrastructure/server-machines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const currentProtocol = "2026-07-28";

const noStore = { "Cache-Control": "no-store, private" };
const target = z
  .object({
    app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    machineId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  })
  .strict();
const createInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    size: z.enum(["low", "medium", "high"]),
    region: z
      .string()
      .regex(/^[a-z]{3,4}$/)
      .optional(),
    sleepWhenIdle: z.boolean(),
    requestId: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();
const commandInput = target
  .extend({
    command: z.string().trim().min(1).max(4000),
    timeoutSeconds: z.number().int().min(1).max(30).default(15),
    confirm: z.literal(true),
  })
  .strict();
const confirmedTarget = target.extend({ confirm: z.literal(true) }).strict();
const repoInput = z
  .object({
    url: z.url().max(500),
    rootDirectory: z.string().max(200).optional(),
  })
  .strict();
const deployAppInput = repoInput
  .extend({
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    confirm: z.literal(true),
  })
  .strict();
const appInput = z
  .object({ app: z.string().regex(/^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/) })
  .strict();
const resetAppPasswordInput = appInput
  .extend({ confirm: z.literal(true) })
  .strict();
const taskStatusInput = z.object({}).strict();
const inputSchemas = {
  flyhub_list_apps: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  flyhub_app_status: {
    type: "object",
    properties: { app: { type: "string" } },
    required: ["app"],
    additionalProperties: false,
  },
  flyhub_inspect_app: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      rootDirectory: { type: "string" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  flyhub_deploy_app: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      rootDirectory: { type: "string" },
      commitSha: { type: "string" },
      confirm: { type: "boolean", const: true },
    },
    required: ["url", "commitSha", "confirm"],
    additionalProperties: false,
  },
  flyhub_reset_app_password: {
    type: "object",
    properties: {
      app: { type: "string" },
      confirm: { type: "boolean", const: true },
    },
    required: ["app", "confirm"],
    additionalProperties: false,
  },
  flyhub_list_machines: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  flyhub_get_machine: {
    type: "object",
    properties: { app: { type: "string" }, machineId: { type: "string" } },
    required: ["app", "machineId"],
    additionalProperties: false,
  },
  flyhub_create_machine: {
    type: "object",
    properties: {
      name: { type: "string" },
      size: { type: "string", enum: ["low", "medium", "high"] },
      region: { type: "string" },
      sleepWhenIdle: { type: "boolean" },
      requestId: { type: "string", format: "uuid" },
      confirm: { type: "boolean", const: true },
    },
    required: ["name", "size", "sleepWhenIdle", "requestId", "confirm"],
    additionalProperties: false,
  },
  flyhub_start_machine: {
    type: "object",
    properties: { app: { type: "string" }, machineId: { type: "string" } },
    required: ["app", "machineId"],
    additionalProperties: false,
  },
  flyhub_suspend_machine: {
    type: "object",
    properties: { app: { type: "string" }, machineId: { type: "string" } },
    required: ["app", "machineId"],
    additionalProperties: false,
  },
  flyhub_destroy_machine: {
    type: "object",
    properties: {
      app: { type: "string" },
      machineId: { type: "string" },
      confirm: { type: "boolean", const: true },
    },
    required: ["app", "machineId", "confirm"],
    additionalProperties: false,
  },
  flyhub_run_command: {
    type: "object",
    properties: {
      app: { type: "string" },
      machineId: { type: "string" },
      command: { type: "string" },
      timeoutSeconds: { type: "integer", minimum: 1, maximum: 30 },
      confirm: { type: "boolean", const: true },
    },
    required: ["app", "machineId", "command", "confirm"],
    additionalProperties: false,
  },
  flyhub_task_inspect: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  flyhub_task_deploy: {
    type: "object",
    properties: {
      rootDirectory: { type: "string" },
      dockerfileContent: { type: "string" },
      startCommand: { type: "string" },
      port: { type: "integer" },
      storagePath: { type: "string" },
      runtimeEnv: { type: "object", additionalProperties: { type: "string" } },
      generatedSecrets: { type: "array", items: { type: "string" } },
      appPasswordEnv: { type: "string" },
      verificationPath: { type: "string" },
    },
    required: ["port"],
    additionalProperties: false,
  },
  flyhub_task_status: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

const tools = [
  {
    name: "flyhub_list_apps",
    description:
      "List deployed password-protected Fly Hub apps and their URLs. Requires read scope.",
    inputSchema: inputSchemas.flyhub_list_apps,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_app_status",
    description:
      "Check whether an app build is still running and whether its URL is ready. Requires read scope.",
    inputSchema: inputSchemas.flyhub_app_status,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_inspect_app",
    description:
      "Inspect a public GitHub repository and return its pinned commit, build plan, and required secrets before deployment. Requires read scope.",
    inputSchema: inputSchemas.flyhub_inspect_app,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_deploy_app",
    description:
      "Deploy the inspected public GitHub commit as a password-protected app. Requires explicit confirmation and manage scope. Returns a generated password once; save it. The URL is usable only after the build is ready.",
    inputSchema: inputSchemas.flyhub_deploy_app,
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: "flyhub_reset_app_password",
    description:
      "Generate a new shared password for a Fly Hub app and revoke existing sessions. Requires explicit confirmation and manage scope.",
    inputSchema: inputSchemas.flyhub_reset_app_password,
    annotations: { destructiveHint: true },
  },
  {
    name: "flyhub_list_machines",
    description: "List Fly Hub machines in the connected Fly organization.",
    inputSchema: inputSchemas.flyhub_list_machines,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_get_machine",
    description: "Get one Fly Hub machine's status and metadata.",
    inputSchema: inputSchemas.flyhub_get_machine,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_create_machine",
    description:
      "Create an SSH-capable Fly Hub machine. Requires explicit confirmation and a unique requestId for retries.",
    inputSchema: inputSchemas.flyhub_create_machine,
    annotations: { destructiveHint: false },
  },
  {
    name: "flyhub_start_machine",
    description: "Start a Fly Hub machine.",
    inputSchema: inputSchemas.flyhub_start_machine,
  },
  {
    name: "flyhub_suspend_machine",
    description: "Suspend a Fly Hub machine.",
    inputSchema: inputSchemas.flyhub_suspend_machine,
  },
  {
    name: "flyhub_destroy_machine",
    description:
      "Permanently destroy a Fly Hub machine. Requires explicit confirmation.",
    inputSchema: inputSchemas.flyhub_destroy_machine,
    annotations: { destructiveHint: true },
  },
  {
    name: "flyhub_run_command",
    description:
      "Run one noninteractive shell command on a started Fly Hub machine. Requires explicit confirmation. Output is limited to 16 KiB per stream and execution to 30 seconds.",
    inputSchema: inputSchemas.flyhub_run_command,
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: "flyhub_task_inspect",
    description:
      "Inspect the GitHub repository and pinned commit for this Fly Hub deployment task. Read-only.",
    inputSchema: inputSchemas.flyhub_task_inspect,
    annotations: { readOnlyHint: true },
  },
  {
    name: "flyhub_task_deploy",
    description:
      "Build or retry the task repository as a password-protected app. Supply a Dockerfile when needed. The user must approve this action in Eve. App passwords are returned only to Fly Hub's UI.",
    inputSchema: inputSchemas.flyhub_task_deploy,
    annotations: { openWorldHint: true },
  },
  {
    name: "flyhub_task_status",
    description:
      "Check the app build, readiness, and error details after deploying this task repository.",
    inputSchema: inputSchemas.flyhub_task_status,
    annotations: { readOnlyHint: true },
  },
];

type ToolName = keyof typeof inputSchemas;

function rpc(id: unknown, result: unknown, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { status, headers: noStore },
  );
}
function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: noStore },
  );
}
function toolResult(value: unknown, current: boolean) {
  return {
    ...(current ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: Array.isArray(value) ? { machines: value } : value,
  };
}
function cfg(grant: FlyHubMcpGrant) {
  return { token: grant.token, orgSlug: grant.orgSlug, defaultRegion: "iad" };
}
function ownApp(grant: FlyHubMcpGrant) {
  return managedMachineAppName("flyhub", "machines", grant.orgSlug);
}
function hubRequest(
  grant: FlyHubMcpGrant,
  path: string,
  method = "GET",
  body?: unknown,
): NextRequest {
  const origin = "https://flyhub.local";
  const response = NextResponse.json({});
  setHubSession(response, { token: grant.token, orgSlug: grant.orgSlug });
  const cookie = response.cookies.get("fly_hub_session")?.value;
  if (!cookie) throw new Error("Could not create app request session.");
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      host: "flyhub.local",
      origin,
      cookie: `fly_hub_session=${cookie}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function taskRequest(
  task: FlyHubEveTask,
  grantValue: string,
  path: string,
  method = "GET",
  body?: unknown,
): NextRequest {
  const origin = "https://flyhub.local";
  const response = NextResponse.json({});
  setHubSession(response, { token: task.token, orgSlug: task.orgSlug });
  const cookie = response.cookies.get("fly_hub_session")?.value;
  if (!cookie) throw new Error("Could not create app request session.");
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      host: "flyhub.local",
      origin,
      cookie: `fly_hub_session=${cookie}`,
      "content-type": "application/json",
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify({ ...body, taskGrant: grantValue }) }),
  });
}
async function hubResult(response: Response) {
  const body = await response
    .json()
    .catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `App request failed (HTTP ${response.status}).`,
    );
  return body;
}
async function authorizedMachine(
  grant: FlyHubMcpGrant,
  input: z.infer<typeof target>,
) {
  if (input.app !== ownApp(grant))
    throw new Error("Machine is outside this Fly Hub workspace.");
  const inventory = await listServerProviderInventory(cfg(grant));
  const row = inventory.machines.find(
    (machine) =>
      machine.app === input.app && machine.machineId === input.machineId,
  );
  if (!row) throw new Error("Machine not found.");
  return row;
}
function audit(
  grant: FlyHubMcpGrant,
  name: string,
  targetInfo: { app?: string; machineId?: string },
  outcome: string,
  command?: string,
) {
  console.info(
    "fly_hub_mcp_action",
    JSON.stringify({
      grantId: grant.id,
      orgSlug: grant.orgSlug,
      tool: name,
      ...targetInfo,
      outcome,
      ...(command
        ? { commandSha256: createHash("sha256").update(command).digest("hex") }
        : {}),
    }),
  );
}
async function runCommand(
  grant: FlyHubMcpGrant,
  input: z.infer<typeof commandInput>,
) {
  const response = await fetch(
    `https://api.machines.dev/v1/apps/${input.app}/machines/${input.machineId}/exec`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${grant.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: ["/bin/sh", "-lc", input.command],
        timeout: input.timeoutSeconds,
      }),
      signal: AbortSignal.timeout((input.timeoutSeconds + 5) * 1000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new Error(`Fly command failed (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Fly returned no command result.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 128 * 1024) {
      await reader.cancel();
      throw new Error("Command result exceeded 128 KiB.");
    }
    chunks.push(value);
  }
  const result = z
    .object({
      stdout: z.string().default(""),
      stderr: z.string().default(""),
      exit_code: z.number().optional(),
      exit_signal: z.number().optional(),
    })
    .passthrough()
    .parse(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))));
  const limit = (value: string) => ({
    text: value.slice(0, 16_384),
    truncated: value.length > 16_384,
  });
  return {
    exitCode: result.exit_code ?? null,
    exitSignal: result.exit_signal ?? null,
    stdout: limit(result.stdout),
    stderr: limit(result.stderr),
  };
}

async function callTool(grant: FlyHubMcpGrant, name: ToolName, args: unknown) {
  const required =
    name === "flyhub_run_command"
      ? "command"
      : name === "flyhub_list_machines" ||
          name === "flyhub_get_machine" ||
          name === "flyhub_list_apps" ||
          name === "flyhub_app_status" ||
          name === "flyhub_inspect_app"
        ? "read"
        : "manage";
  if (!grant.scopes.includes(required))
    throw new Error(`This credential lacks the ${required} scope.`);
  if (name === "flyhub_list_apps") {
    z.object({}).strict().parse(args);
    return hubResult(await listHubApps(hubRequest(grant, "/api/fly-hub/apps")));
  }
  if (name === "flyhub_app_status") {
    const input = appInput.parse(args);
    return hubResult(
      await listHubApps(
        hubRequest(
          grant,
          `/api/fly-hub/apps?pending=${encodeURIComponent(input.app)}`,
        ),
      ),
    );
  }
  if (name === "flyhub_inspect_app") {
    const input = repoInput.parse(args);
    return hubResult(
      await inspectHubApp(
        hubRequest(grant, "/api/fly-hub/apps/inspect", "POST", input),
      ),
    );
  }
  if (name === "flyhub_deploy_app") {
    const { confirm: _confirm, ...input } = deployAppInput.parse(args);
    const result = await hubResult(
      await deployHubApp(hubRequest(grant, "/api/fly-hub/apps", "POST", input)),
    );
    audit(grant, name, {}, "started");
    return result;
  }
  if (name === "flyhub_reset_app_password") {
    const input = resetAppPasswordInput.parse(args);
    const result = await hubResult(
      await resetHubAppPassword(
        hubRequest(grant, `/api/fly-hub/apps/${input.app}/password`, "POST"),
        { params: Promise.resolve({ app: input.app }) },
      ),
    );
    audit(grant, name, { app: input.app }, "ok");
    return result;
  }
  if (name === "flyhub_list_machines") {
    z.object({}).strict().parse(args);
    const inventory = await listServerProviderInventory(cfg(grant));
    return inventory.machines.filter((row) => row.app === ownApp(grant));
  }
  if (name === "flyhub_create_machine") {
    const input = createInput.parse(args);
    try {
      const result = await createManagedMachine({
        ...input,
        owner: "flyhub",
        repo: "machines",
        cfg: cfg(grant),
      });
      audit(grant, name, result, "ok");
      return result;
    } catch (error) {
      audit(grant, name, {}, "failed");
      throw error;
    }
  }
  if (name === "flyhub_run_command") {
    const input = commandInput.parse(args);
    const row = await authorizedMachine(grant, input);
    if (row.state !== "started" && row.state !== "running")
      throw new Error("Start the machine before running a command.");
    try {
      const result = await runCommand(grant, input);
      audit(
        grant,
        name,
        { app: input.app, machineId: input.machineId },
        `exit:${result.exitCode}`,
        input.command,
      );
      return result;
    } catch (error) {
      audit(
        grant,
        name,
        { app: input.app, machineId: input.machineId },
        "failed",
        input.command,
      );
      throw error;
    }
  }
  const input =
    name === "flyhub_destroy_machine"
      ? confirmedTarget.parse(args)
      : target.parse(args);
  const row = await authorizedMachine(grant, input);
  if (name === "flyhub_get_machine") return row;
  try {
    if (name === "flyhub_start_machine")
      await startServerProviderMachine(input.app, input.machineId, cfg(grant));
    if (name === "flyhub_suspend_machine")
      await suspendMachine(input.app, input.machineId, cfg(grant));
    if (name === "flyhub_destroy_machine")
      await destroyMachine(input.app, input.machineId, cfg(grant));
    audit(grant, name, input, "ok");
    return { ok: true, app: input.app, machineId: input.machineId };
  } catch (error) {
    audit(grant, name, input, "failed");
    throw error;
  }
}

async function callTaskTool(
  task: FlyHubEveTask,
  grantValue: string,
  name: string,
  args: unknown,
) {
  const [owner, repo] = task.repository.split("/");
  if (name === "flyhub_task_inspect") {
    z.object({}).strict().parse(args);
    return inspectPublicGitHubApp({
      url: `https://github.com/${task.repository}`,
      org: task.orgSlug,
      commitSha: task.commitSha,
    });
  }
  if (name === "flyhub_task_deploy") {
    const build = taskBuildSchema.parse(args);
    const result = await hubResult(
      await deployHubApp(
        taskRequest(task, grantValue, "/api/fly-hub/apps", "POST", {
          taskBuild: build,
        }),
      ),
    );
    return {
      appName: result.appName,
      url: result.url,
      status: result.status,
      message:
        "Build started. Use flyhub_task_status to check the result. Fly Hub will show passwords to the user.",
    };
  }
  if (name === "flyhub_task_status") {
    taskStatusInput.parse(args);
    const appName = flyHubAppName(task.orgSlug, owner, repo, ".");
    const result = await hubResult(
      await listHubApps(
        taskRequest(
          task,
          grantValue,
          `/api/fly-hub/apps?pending=${encodeURIComponent(appName)}`,
        ),
      ),
    );
    return {
      appName,
      url: `https://${appName}.fly.dev`,
      app:
        result.apps.find(
          (app: { appName: string }) => app.appName === appName,
        ) ?? null,
      pendingStatus: result.pendingStatus,
      ready: result.pendingReady,
    };
  }
  throw new Error("Unknown Fly Hub task tool.");
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const grant = readFlyHubMcpGrant(auth);
  const taskValue = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  const task = readFlyHubEveTask(taskValue);
  if (!grant && !task)
    return NextResponse.json(
      { error: "invalid_token" },
      {
        status: 401,
        headers: {
          ...noStore,
          "WWW-Authenticate": 'Bearer realm="Fly Hub MCP"',
        },
      },
    );
  const origin = req.headers.get("origin");
  const allowedOrigins = (process.env.FLY_HUB_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim());
  if (
    origin &&
    origin !== req.nextUrl.origin &&
    !allowedOrigins.includes(origin)
  )
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 403, headers: noStore },
    );
  if (
    (req.headers.get("content-type") ?? "").split(";", 1)[0]?.trim() !==
    "application/json"
  )
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415, headers: noStore },
    );
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 256 * 1024)
    return NextResponse.json(
      { error: "request_too_large" },
      { status: 413, headers: noStore },
    );
  let request: {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: { name?: unknown; arguments?: unknown; _meta?: unknown };
  } | null = null;
  try {
    request = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (!request || typeof request.method !== "string")
    return rpcError(null, -32600, "Invalid request", 400);
  if (request.jsonrpc !== "2.0")
    return rpcError(request.id, -32600, "Invalid request", 400);
  const current = req.headers.get("mcp-protocol-version") === currentProtocol;
  if (current) {
    const meta = z
      .object({
        "io.modelcontextprotocol/protocolVersion": z.literal(currentProtocol),
        "io.modelcontextprotocol/clientInfo": z.object({
          name: z.string(),
          version: z.string(),
        }),
        "io.modelcontextprotocol/clientCapabilities": z.record(
          z.string(),
          z.unknown(),
        ),
      })
      .passthrough()
      .safeParse(request.params?._meta);
    if (
      !meta.success ||
      req.headers.get("mcp-method") !== request.method ||
      (request.method === "tools/call" &&
        req.headers.get("mcp-name") !== request.params?.name)
    )
      return rpcError(request.id, -32602, "Invalid MCP routing metadata", 400);
  }
  if (request.method === "initialize")
    return rpc(request.id, {
      protocolVersion: current ? currentProtocol : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fly-hub", version: "1.0.0" },
    });
  if (request.method === "server/discover")
    return rpc(request.id, {
      protocolVersion: currentProtocol,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fly-hub", version: "1.0.0" },
    });
  if (request.method === "notifications/initialized")
    return new Response(null, { status: 202, headers: noStore });
  if (request.method === "ping") return rpc(request.id, {});
  if (request.method === "tools/list")
    return rpc(request.id, {
      ...(current
        ? { resultType: "complete", ttlMs: 60_000, cacheScope: "private" }
        : {}),
      tools: tools.filter((tool) => {
        if (task) return tool.name.startsWith("flyhub_task_");
        if (tool.name.startsWith("flyhub_task_")) return false;
        const scope =
          tool.name === "flyhub_run_command"
            ? "command"
            : tool.name === "flyhub_list_machines" ||
                tool.name === "flyhub_get_machine" ||
                tool.name === "flyhub_list_apps" ||
                tool.name === "flyhub_app_status" ||
                tool.name === "flyhub_inspect_app"
              ? "read"
              : "manage";
        return grant!.scopes.includes(scope);
      }),
    });
  if (request.method !== "tools/call")
    return rpcError(request.id, -32601, "Method not found");
  const name = request.params?.name;
  if (typeof name !== "string" || !(name in inputSchemas))
    return rpcError(request.id, -32602, "Unknown tool");
  if (name.startsWith("flyhub_task_") !== Boolean(task))
    return rpcError(request.id, -32602, "Tool unavailable for this credential");
  try {
    return rpc(
      request.id,
      toolResult(
        task
          ? await callTaskTool(
              task,
              taskValue,
              name,
              request.params?.arguments ?? {},
            )
          : await callTool(
              grant!,
              name as ToolName,
              request.params?.arguments ?? {},
            ),
        current,
      ),
    );
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Invalid tool arguments"
        : error instanceof Error
          ? error.message
          : "Tool failed";
    return rpc(request.id, {
      ...(current ? { resultType: "complete" } : {}),
      isError: true,
      content: [{ type: "text", text: message }],
    });
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const grant = readFlyHubMcpGrant(auth);
  const task = readFlyHubEveTask(
    auth?.startsWith("Bearer ") ? auth.slice(7) : "",
  );
  if (!grant && !task)
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 401, headers: noStore },
    );
  return new Response(": fly-hub-mcp\n\n", {
    headers: { ...noStore, "Content-Type": "text/event-stream" },
  });
}
