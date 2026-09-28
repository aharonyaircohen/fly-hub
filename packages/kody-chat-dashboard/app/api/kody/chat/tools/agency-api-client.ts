interface RequestContext {
  url: string;
  headers: Headers;
}

type JsonObject = Record<string, unknown>;

interface AgentCreateInput extends JsonObject {
  slug?: string;
  title: string;
  body: string;
  whenToUse?: string;
  capabilities?: string[];
}

interface CapabilityWriteInput extends JsonObject {
  slug?: string;
  instructions: string;
  contract?: string | null;
  skills: Array<{ path: string; content: string }>;
  tools: Array<{ path: string; content: string }>;
}

interface LoopWriteInput extends JsonObject {
  id?: string;
  trigger: JsonObject;
  target: { kind: "workflow" | "capability"; id: string };
  input: JsonObject;
  enabled: boolean;
}

function requestHeaders(request: RequestContext, json = false): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  if (json) headers.set("content-type", "application/json");
  return headers;
}

async function apiResult(response: Response): Promise<JsonObject> {
  const payload = (await response.json().catch(() => ({}))) as JsonObject;
  if (response.ok) return payload;
  return {
    error:
      typeof payload.error === "string"
        ? payload.error
        : "agency_request_failed",
    ...(response.status < 500 && typeof payload.message === "string"
      ? { message: payload.message }
      : {}),
    ...(response.status < 500 && Array.isArray(payload.issues)
      ? { issues: payload.issues }
      : {}),
    status: response.status,
  };
}

function pathWithActor(path: string, actorLogin?: string | null): string {
  if (!actorLogin) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}actorLogin=${encodeURIComponent(actorLogin)}`;
}

export function createAgencyApiClient({
  request,
  actorLogin,
  fetchImpl = fetch,
}: {
  request: RequestContext;
  actorLogin?: string | null;
  fetchImpl?: typeof fetch;
}) {
  async function send(
    path: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    body?: JsonObject,
  ): Promise<JsonObject> {
    return apiResult(
      await fetchImpl(new URL(path, request.url), {
        method,
        headers: requestHeaders(request, body !== undefined),
        cache: method === "GET" ? "no-store" : undefined,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify({
                ...body,
                ...(actorLogin ? { actorLogin } : {}),
              }),
            }),
      }),
    );
  }

  const itemPath = (base: string, id: string) =>
    `${base}/${encodeURIComponent(id)}`;

  async function exists(result: JsonObject): Promise<boolean | JsonObject> {
    if (result.status === 404) return false;
    if (typeof result.error === "string") return result;
    return true;
  }

  function without<T extends JsonObject>(input: T, key: string): JsonObject {
    return Object.fromEntries(
      Object.entries(input).filter(([entryKey]) => entryKey !== key),
    );
  }

  function todoItemId(): string {
    return `item-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  const client = {
    listAgents: () => send("/api/kody/agents", "GET"),
    readAgent: (slug: string) =>
      send(itemPath("/api/kody/agents", slug), "GET"),
    createAgent: (input: AgentCreateInput) =>
      send("/api/kody/agents", "POST", input),
    updateAgent: (slug: string, input: JsonObject) =>
      send(itemPath("/api/kody/agents", slug), "PATCH", input),
    removeAgent: (slug: string) =>
      send(
        pathWithActor(itemPath("/api/kody/agents", slug), actorLogin),
        "DELETE",
      ),
    dispatchAgent: (slug: string, message: string) =>
      send(`${itemPath("/api/kody/agents", slug)}/dispatch`, "POST", {
        message,
      }),

    listCapabilities: () => send("/api/kody/capabilities", "GET"),
    getBlueprintStatus: () => send("/api/kody/blueprints/status", "GET"),
    readCapability: (slug: string) =>
      send(itemPath("/api/kody/capabilities", slug), "GET"),
    createCapability: (input: CapabilityWriteInput) =>
      send("/api/kody/capabilities", "POST", input),
    updateCapability: (slug: string, input: CapabilityWriteInput) =>
      send(
        itemPath("/api/kody/capabilities", slug),
        "PATCH",
        without(input, "slug"),
      ),
    removeCapability: (slug: string) =>
      send(
        pathWithActor(itemPath("/api/kody/capabilities", slug), actorLogin),
        "DELETE",
      ),
    runCapability: (slug: string) =>
      send(`${itemPath("/api/kody/capabilities", slug)}/run`, "POST", {}),

    createWorkflow: (input: JsonObject) =>
      send("/api/kody/company/workflows", "POST", input),
    readWorkflow: (id: string, includeStore = false) =>
      send(
        `${itemPath("/api/kody/company/workflows", id)}${includeStore ? "?includeStore=true" : ""}`,
        "GET",
      ),
    updateWorkflow: (id: string, input: JsonObject) =>
      send(itemPath("/api/kody/company/workflows", id), "PATCH", input),
    removeWorkflow: (id: string) =>
      send(itemPath("/api/kody/company/workflows", id), "DELETE"),

    listLoops: () => send("/api/kody/loops", "GET"),
    createLoop: (input: LoopWriteInput) =>
      send("/api/kody/loops", "POST", input),
    updateLoop: (id: string, input: LoopWriteInput) =>
      send(itemPath("/api/kody/loops", id), "PATCH", input),
    removeLoop: (id: string) => send(itemPath("/api/kody/loops", id), "DELETE"),
    runLoop: (id: string) =>
      send(`${itemPath("/api/kody/loops", id)}/run`, "POST", {
        approved: true,
      }),

    listIntents: () => send("/api/kody/intents", "GET"),
    readIntent: (slug: string) =>
      send(itemPath("/api/kody/intents", slug), "GET"),
    createIntent: (input: JsonObject) =>
      send("/api/kody/intents", "POST", input),
    updateIntent: (slug: string, input: JsonObject) =>
      send(itemPath("/api/kody/intents", slug), "PATCH", input),
    removeIntent: (slug: string) =>
      send(
        pathWithActor(itemPath("/api/kody/intents", slug), actorLogin),
        "DELETE",
      ),

    listTodos: () => send("/api/kody/todos", "GET"),
    readTodo: (slug: string) => send(itemPath("/api/kody/todos", slug), "GET"),
    createTodo: (input: JsonObject) => send("/api/kody/todos", "POST", input),
    updateTodo: (slug: string, input: JsonObject) =>
      send(itemPath("/api/kody/todos", slug), "PATCH", input),
    runAgencyRequest: (slug: string) =>
      send(`${itemPath("/api/kody/agency-requests", slug)}/run`, "POST", {}),
    removeTodo: (slug: string) =>
      send(
        pathWithActor(itemPath("/api/kody/todos", slug), actorLogin),
        "DELETE",
      ),

    listRuns: (limit = 50) =>
      send(
        `/api/kody/agency-runs?limit=${Math.max(1, Math.min(100, limit))}`,
        "GET",
      ),
    readRun: (runId: string, githubRunId?: string) => {
      const query = new URLSearchParams({ runId });
      if (githubRunId) query.set("githubRunId", githubRunId);
      return send(`/api/kody/agency-runs/detail?${query.toString()}`, "GET");
    },
  };

  return {
    ...client,
    async saveCapability(input: CapabilityWriteInput & { slug: string }) {
      const state = await exists(await client.readCapability(input.slug));
      if (typeof state === "object") return state;
      return state
        ? client.updateCapability(input.slug, input)
        : client.createCapability(input);
    },
    async saveWorkflow(input: JsonObject & { id?: string }) {
      if (!input.id) return client.createWorkflow(input);
      const response = await send(
        itemPath("/api/kody/company/workflows", input.id),
        "GET",
      );
      const state = await exists(response);
      if (typeof state === "object") return state;
      return state
        ? client.updateWorkflow(input.id, without(input, "id"))
        : client.createWorkflow(input);
    },
    async readLoop(loopId: string) {
      const result = await client.listLoops();
      if (typeof result.error === "string") return result;
      const loops = Array.isArray(result.loops) ? result.loops : [];
      const loop = loops.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as { id?: unknown }).id === loopId,
      );
      return loop ? { loop } : { error: "not_found", status: 404 };
    },
    async saveLoop(input: LoopWriteInput & { id: string }) {
      const result = await client.listLoops();
      if (typeof result.error === "string") return result;
      const loops = Array.isArray(result.loops) ? result.loops : [];
      const present = loops.some(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          (candidate as { id?: unknown }).id === input.id,
      );
      return present
        ? client.updateLoop(input.id, without(input, "id") as LoopWriteInput)
        : client.createLoop(input);
    },
    async saveIntent(input: JsonObject & { slug?: string }) {
      if (!input.slug) return client.createIntent(input);
      const state = await exists(await client.readIntent(input.slug));
      if (typeof state === "object") return state;
      return state
        ? client.updateIntent(input.slug, without(input, "slug"))
        : client.createIntent(input);
    },
    async saveTodo(input: JsonObject & { slug?: string }) {
      if (!input.slug) return client.createTodo(input);
      const existing = await client.readTodo(input.slug);
      const state = await exists(existing);
      if (typeof state === "object") return state;
      if (!state) return client.createTodo(input);

      const now = new Date().toISOString();
      const existingTodo =
        existing.todo && typeof existing.todo === "object"
          ? (existing.todo as JsonObject)
          : {};
      const existingItems = Array.isArray(existingTodo.items)
        ? existingTodo.items
        : [];
      const existingById = new Map(
        existingItems
          .filter(
            (item): item is JsonObject =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
          .map((item) => [item.id, item]),
      );
      const items = Array.isArray(input.items)
        ? input.items.map((raw) => {
            const item = raw as JsonObject;
            const id = typeof item.id === "string" ? item.id : todoItemId();
            const previous = existingById.get(id);
            const completed = item.completed === true;
            return {
              ...item,
              id,
              body: typeof item.body === "string" ? item.body : "",
              assignee:
                typeof item.assignee === "string"
                  ? item.assignee.replace(/^@+/, "") || null
                  : null,
              completed,
              createdAt:
                typeof item.createdAt === "string"
                  ? item.createdAt
                  : typeof previous?.createdAt === "string"
                    ? previous.createdAt
                    : now,
              completedAt: completed
                ? typeof item.completedAt === "string"
                  ? item.completedAt
                  : now
                : null,
            };
          })
        : undefined;
      return client.updateTodo(input.slug, {
        ...without(input, "slug"),
        ...(items ? { items } : {}),
      });
    },
  };
}

export type AgencyApiClient = ReturnType<typeof createAgencyApiClient>;
