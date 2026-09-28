import "server-only";

type HermesRpcResponse = {
  id?: string | number;
  result?: unknown;
  error?: { message?: string };
};

const DEFAULT_HERMES_URL = "http://127.0.0.1:9119";
const TOKEN_PATTERN = /__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)/;

function resolveBaseUrl(): URL {
  const value = process.env.HERMES_BASE_URL?.trim() || DEFAULT_HERMES_URL;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Hermes must use an http or https URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Hermes base URL must not contain credentials or query parameters.");
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

let cachedToken: { base: string; value: string; expiresAt: number } | undefined;

async function getSessionToken(baseUrl: URL): Promise<string> {
  const configured = process.env.HERMES_SESSION_TOKEN?.trim();
  if (configured) return configured;

  if (!isLoopback(baseUrl.hostname)) {
    throw new Error("Set HERMES_SESSION_TOKEN when Hermes is not running on this machine.");
  }
  if (cachedToken?.base === baseUrl.origin && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const response = await fetch(new URL("/", baseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Hermes dashboard returned HTTP ${response.status}.`);
  const html = await response.text();
  const token = TOKEN_PATTERN.exec(html)?.[1];
  if (!token) throw new Error("Hermes dashboard did not provide a local session token.");
  cachedToken = { base: baseUrl.origin, value: token, expiresAt: Date.now() + 60_000 };
  return token;
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = resolveBaseUrl();
  const token = await getSessionToken(base);
  const headers = new Headers(init.headers);
  headers.set("X-Hermes-Session-Token", token);
  return fetch(new URL(path, base), {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Hermes returned HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function listHermesSessions(
  limit = 100,
  source?: string,
): Promise<{ sessions: Array<Record<string, unknown>> }> {
  const params = new URLSearchParams({ limit: String(limit), order: "recent" });
  if (source) params.set("source", source);
  const response = await readJson<{ sessions?: Array<Record<string, unknown>> }>(
    await authorizedFetch(`/api/sessions?${params}`),
  );
  return { sessions: response.sessions ?? [] };
}

export async function getHermesSession(sessionId: string): Promise<Record<string, unknown>> {
  return readJson(await authorizedFetch(`/api/sessions/${encodeURIComponent(sessionId)}`));
}

export async function getHermesSessionMessages(sessionId: string): Promise<unknown> {
  const id = encodeURIComponent(sessionId);
  return readJson(await authorizedFetch(`/api/sessions/${id}/messages`));
}

async function callHermesGateway(
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base = resolveBaseUrl();
  const token = await getSessionToken(base);
  const wsUrl = new URL("/api/ws", base);
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", token);
  const socket = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const id = `kody-${crypto.randomUUID()}`;
    const timer = setTimeout(() => finish(new Error("Hermes request timed out.")), 15_000);
    const finish = (error?: Error, result?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(result ?? {});
    };
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      jsonrpc: "2.0", id, method, params,
    })), { once: true });
    socket.addEventListener("message", (event) => {
      let frame: HermesRpcResponse;
      try { frame = JSON.parse(String(event.data)) as HermesRpcResponse; }
      catch { return; }
      if (frame.id !== id) return;
      if (frame.error) finish(new Error(frame.error.message || "Hermes request failed."));
      else finish(undefined, frame.result as Record<string, unknown> | undefined);
    });
    socket.addEventListener("error", () => finish(new Error("Could not connect to the Hermes gateway.")), { once: true });
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Hermes closed the connection before replying."));
    }, { once: true });
  });
}

export async function deleteHermesSession(sessionId: string, runtimeSessionId?: string): Promise<void> {
  if (runtimeSessionId) {
    await callHermesGateway("session.close", { session_id: runtimeSessionId });
  }
  const response = await authorizedFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Hermes could not delete that session (HTTP ${response.status}).`);
  }
}

export async function updateHermesSession(
  sessionId: string,
  updates: { title?: string; pinned?: boolean },
  runtimeSessionId?: string,
): Promise<void> {
  const patch = () => authorizedFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  let response = await patch();
  if (response.status === 404 && runtimeSessionId) {
    await callHermesGateway("session.title", {
      session_id: runtimeSessionId,
      title: updates.title || "New conversation",
    });
    response = await patch();
  }
  if (!response.ok) throw new Error(`Hermes could not update that session (HTTP ${response.status}).`);
}

export async function createHermesSession(input: {
  title?: string;
  model?: string;
  reasoningEffort?: string;
  source?: string;
}): Promise<Record<string, unknown>> {
  const base = resolveBaseUrl();
  const token = await getSessionToken(base);
  const wsUrl = new URL("/api/ws", base);
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", token);
  const socket = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    const rpcId = `kody-create-${crypto.randomUUID()}`;
    const timer = setTimeout(() => finish(new Error("Hermes did not create the session in time.")), 15_000);
    const finish = (error?: Error, result?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Hermes returned an invalid session."));
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "session.create",
        params: {
          source: input.source || "kody-global",
          close_on_disconnect: false,
          ...(input.title && input.title !== "New conversation" ? { title: input.title } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      let frame: HermesRpcResponse;
      try { frame = JSON.parse(String(event.data)) as HermesRpcResponse; }
      catch { return; }
      if (frame.id !== rpcId) return;
      if (frame.error) return finish(new Error(frame.error.message || "Hermes could not create the session."));
      if (!frame.result || typeof frame.result !== "object") return finish(new Error("Hermes returned an invalid session."));
      finish(undefined, frame.result as Record<string, unknown>);
    });
    socket.addEventListener("error", () => finish(new Error("Could not connect to the Hermes gateway.")), { once: true });
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Hermes closed the connection before creating the session."));
    }, { once: true });
  });
}

export async function streamHermesTurn(
  sessionId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  runtimeSessionId?: string,
): Promise<Response> {
  const base = resolveBaseUrl();
  const token = await getSessionToken(base);
  const wsUrl = new URL("/api/ws", base);
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", token);
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) throw new Error("A message is required.");
  const images = Array.isArray(body.images) ? body.images : [];

  let cancelStream: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const socket = new WebSocket(wsUrl);
      const encoder = new TextEncoder();
      const pending = new Map<string, {
        resolve: (value: Record<string, unknown>) => void;
        reject: (error: Error) => void;
      }>();
      let closed = false;
      let activeRuntimeId = runtimeSessionId ?? "";
      const timeout = setTimeout(() => fail("Hermes did not finish this reply in time."), 300_000);
      const emit = (type: string, payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        socket.close();
        controller.close();
      };
      cancelStream = finish;
      const fail = (message: string) => {
        if (closed) return;
        emit("error", { message });
        finish();
      };
      const onAbort = () => finish();
      const rpc = (method: string, params: Record<string, unknown>) => {
        const id = `kody-${crypto.randomUUID()}`;
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      };
      const startTurn = async () => {
        if (!activeRuntimeId) {
          const resumed = await rpc("session.resume", { session_id: sessionId, close_on_disconnect: false });
          activeRuntimeId = String(resumed.session_id ?? "");
          if (!activeRuntimeId) throw new Error("Hermes returned no active session.");
        }

        if (typeof body.model === "string" && body.model.trim()) {
          const result = await rpc("config.set", {
            session_id: activeRuntimeId,
            key: "model",
            value: body.model,
            confirm_expensive_model: true,
          });
          if (result.confirm_required === true) {
            throw new Error(String(result.confirm_message ?? "Hermes needs model confirmation."));
          }
        }
        const options = body.model_options && typeof body.model_options === "object"
          ? body.model_options as Record<string, unknown>
          : {};
        if (typeof options.reasoning_effort === "string" && options.reasoning_effort.trim()) {
          await rpc("config.set", {
            session_id: activeRuntimeId,
            key: "reasoning",
            value: options.reasoning_effort,
            scope: "session",
          });
        }
        for (const raw of images) {
          if (!raw || typeof raw !== "object") continue;
          const image = raw as { name?: unknown; dataUrl?: unknown };
          if (typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/")) continue;
          const comma = image.dataUrl.indexOf(",");
          if (comma < 0) continue;
          await rpc("image.attach_bytes", {
            session_id: activeRuntimeId,
            content_base64: image.dataUrl.slice(comma + 1),
            filename: typeof image.name === "string" ? image.name : "image.png",
          });
        }
        await rpc("prompt.submit", {
          session_id: activeRuntimeId,
          text: message,
          ...(body.hidden === true ? { display_kind: "hidden" } : {}),
        });
      };

      socket.addEventListener("open", () => {
        void startTurn().catch((error: unknown) => {
          fail(error instanceof Error ? error.message : "Hermes could not start this reply.");
        });
      }, { once: true });
      socket.addEventListener("message", (event) => {
        let frame: HermesRpcResponse & { method?: string; params?: Record<string, unknown> };
        try { frame = JSON.parse(String(event.data)) as typeof frame; }
        catch { return; }
        if (frame.id && typeof frame.id === "string" && pending.has(frame.id)) {
          const request = pending.get(frame.id)!;
          pending.delete(frame.id);
          if (frame.error) request.reject(new Error(frame.error.message || "Hermes request failed."));
          else request.resolve((frame.result ?? {}) as Record<string, unknown>);
          return;
        }
        if (frame.method !== "event" || !frame.params) return;
        const eventSessionId = String(frame.params.session_id ?? "");
        if (eventSessionId && activeRuntimeId && eventSessionId !== activeRuntimeId) return;
        const type = String(frame.params.type ?? "");
        const payload = frame.params.payload && typeof frame.params.payload === "object"
          ? frame.params.payload as Record<string, unknown>
          : {};
        if (type === "message.delta") emit("assistant.delta", { delta: String(payload.text ?? "") });
        else if (type === "reasoning.delta") emit("reasoning.delta", payload);
        else if (type === "tool.start") emit("tool.started", payload);
        else if (type === "tool.complete") emit("tool.complete", payload);
        else if (type === "session.title") emit("session.title", payload);
        else if (type === "message.complete") {
          const text = typeof payload.text === "string" ? payload.text : "";
          emit("assistant.completed", { content: text, status: payload.status });
          if (payload.status === "error" || payload.status === "interrupted") {
            emit("run.failed", { message: typeof payload.error === "string" ? payload.error : "Hermes could not finish this reply." });
          }
          finish();
        } else if (type === "error") {
          emit("error", { message: String(payload.message ?? "Hermes could not finish this reply.") });
          finish();
        }
      });
      socket.addEventListener("error", () => fail("Could not connect to the Hermes gateway."), { once: true });
      socket.addEventListener("close", () => {
        if (!closed) fail("Hermes closed the connection before the reply finished.");
      }, { once: true });
      if (signal?.aborted) finish();
      else signal?.addEventListener("abort", onAbort, { once: true });
    },
    cancel() {
      cancelStream?.();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}

export async function getHermesModels(): Promise<unknown> {
  return readJson(await authorizedFetch("/api/model/options"));
}

export async function attachHermesFile(
  sessionId: string,
  input: { name: string; dataUrl: string },
  runtimeSessionId?: string,
): Promise<{ ref_text: string }> {
  const base = resolveBaseUrl();
  const token = await getSessionToken(base);
  const wsUrl = new URL("/api/ws", base);
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", token);
  const socket = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    let stage: "resume" | "attach" = runtimeSessionId ? "attach" : "resume";
    let activeRuntimeId = runtimeSessionId ?? "";
    let settled = false;
    const resumeId = `kody-resume-${crypto.randomUUID()}`;
    const attachId = `kody-attach-${crypto.randomUUID()}`;
    const timer = setTimeout(() => finish(new Error("Hermes file upload timed out.")), 30_000);
    const finish = (error?: Error, result?: { ref_text: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Hermes returned no file reference."));
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        jsonrpc: "2.0", id: stage === "resume" ? resumeId : attachId,
        method: stage === "resume" ? "session.resume" : "file.attach",
        params: stage === "resume"
          ? { session_id: sessionId, close_on_disconnect: false }
          : { session_id: activeRuntimeId, name: input.name, data_url: input.dataUrl },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      let frame: HermesRpcResponse;
      try { frame = JSON.parse(String(event.data)) as HermesRpcResponse; }
      catch { return; }
      if (stage === "resume" && frame.id === resumeId) {
        if (frame.error) return finish(new Error(frame.error.message || "Hermes could not open the session."));
        const resumed = frame.result as { session_id?: unknown } | undefined;
        activeRuntimeId = typeof resumed?.session_id === "string" ? resumed.session_id : "";
        if (!activeRuntimeId) return finish(new Error("Hermes returned no active session."));
        stage = "attach";
        socket.send(JSON.stringify({
          jsonrpc: "2.0", id: attachId, method: "file.attach",
          params: { session_id: activeRuntimeId, name: input.name, data_url: input.dataUrl },
        }));
      } else if (stage === "attach" && frame.id === attachId) {
        const result = frame.result as { ref_text?: unknown } | undefined;
        if (frame.error) return finish(new Error(frame.error.message || "Hermes could not attach that file."));
        if (typeof result?.ref_text !== "string") return finish(new Error("Hermes returned an invalid file reference."));
        finish(undefined, { ref_text: result.ref_text });
      }
    });
    socket.addEventListener("error", () => finish(new Error("Could not connect to the Hermes gateway.")), { once: true });
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Hermes gateway closed before attaching the file."));
    }, { once: true });
  });
}
