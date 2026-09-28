import { TERMINAL_CLAIMS_VALIDATION_SCRIPT } from "@kody-ade/terminal/terminal-claims";

export const TERMINAL_BRIDGE_STATELESS_SCRIPT = String.raw`import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const TOKEN_VERSION = "kody-terminal-v1";
const AGENT_STATUS_TIMEOUT_MS = 20000;
const TERMINAL_UPSTREAM_RETRY_BASE_MS = Math.max(10, Number(process.env.TERMINAL_UPSTREAM_RETRY_BASE_MS) || 1000);
const TERMINAL_UPSTREAM_RETRY_MAX_MS = Math.max(TERMINAL_UPSTREAM_RETRY_BASE_MS, Number(process.env.TERMINAL_UPSTREAM_RETRY_MAX_MS) || 30000);
const TERMINAL_UPSTREAM_ATTEMPT_TIMEOUT_MS = Math.max(1000, Number(process.env.TERMINAL_UPSTREAM_ATTEMPT_TIMEOUT_MS) || 30000);
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_EXEC_OUTPUT_BYTES = 96 * 1024 * 1024;
const MAX_EXEC_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const EXEC_KEEPALIVE_INTERVAL_MS = 15000;
const EXEC_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const secret = process.env.BRIDGE_AUTH_SECRET || "";
const execJobs = new Map();

if (!secret) {
  console.error("BRIDGE_AUTH_SECRET missing");
  process.exit(1);
}

function fromBase64url(input) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function deriveKey(purpose) {
  return crypto.createHash("sha256").update("kody-terminal-bridge:" + purpose + ":" + secret).digest();
}

function sign(parts) {
  return base64url(crypto.createHmac("sha256", deriveKey("hmac")).update(parts.join(".")).digest());
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateTerminalClaims(claims, now) {
${TERMINAL_CLAIMS_VALIDATION_SCRIPT}
}

function verifyTerminalToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("terminal token malformed");
  const [header, encrypted, signature] = parts;
  if (!timingSafeEqualString(signature, sign([header, encrypted]))) {
    throw new Error("terminal token signature invalid");
  }
  const headerJson = JSON.parse(fromBase64url(header).toString("utf8"));
  if (headerJson.typ !== TOKEN_VERSION) throw new Error("terminal token version invalid");
  const packed = fromBase64url(encrypted);
  if (packed.length < 29) throw new Error("terminal token payload invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey("aes"), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  const claims = JSON.parse(
    Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8"),
  );
  const now = Math.floor(Date.now() / 1000);
  validateTerminalClaims(claims, now);
  return claims;
}

function sendFrame(socket, opcode, payload) {
  if (!socket.writable) return;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function sendJson(socket, value) {
  sendFrame(socket, 1, JSON.stringify(value));
}

function closeSocket(socket, code, reason) {
  const text = Buffer.from(String(reason || "").slice(0, 120));
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  sendFrame(socket, 8, payload);
  socket.end();
}

function parseFrames(socket, onText) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const large = buffer.readBigUInt64BE(2);
        if (large > BigInt(MAX_FRAME_BYTES)) return closeSocket(socket, 1009, "frame too large");
        length = Number(large);
        offset = 10;
      }
      if (!masked) return closeSocket(socket, 1002, "client frames must be masked");
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      buffer = buffer.subarray(offset + length);
      if (opcode === 8) return socket.end();
      if (opcode === 9) {
        sendFrame(socket, 10, payload);
        continue;
      }
      if (opcode === 1) onText(payload.toString("utf8"));
    }
  });
}

function flyctlOrgArgs(orgSlug) {
  return orgSlug && orgSlug !== "personal" ? ["--org", orgSlug] : [];
}

function brainAgentArgs(claims) {
  return [
    "ssh",
    "console",
    "--app",
    claims.app,
    ...flyctlOrgArgs(claims.orgSlug),
    ...(claims.privateAddress ? ["--address", claims.privateAddress] : []),
    "--machine",
    claims.machineId,
    "--command",
    "kody-engine brain-terminal-agent --cwd /workspace/repo",
  ];
}

const DIRECT_SSH_SCRIPT = [
  'flyctl ssh issue --agent --org "$KODY_FLY_ORG" --hours 1 >/dev/null',
  'exec ssh -6 -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "root@$KODY_BRAIN_HOST" "$KODY_BRAIN_COMMAND"',
].join(" && ");

function brainPrivateHost(claims) {
  return claims.privateAddress || (claims.machineId + ".vm." + claims.app + ".internal");
}

function spawnBrainCommand(claims, command, stdio = ["pipe", "pipe", "pipe"]) {
  const commonEnv = {
    ...process.env,
    FLY_API_TOKEN: claims.flyToken,
    FLY_ACCESS_TOKEN: claims.flyToken,
  };
  if (process.env.TERMINAL_UPSTREAM_TRANSPORT === "flyctl") {
    return spawn("flyctl", [
      "ssh",
      "console",
      "--app",
      claims.app,
      ...flyctlOrgArgs(claims.orgSlug),
      ...(claims.privateAddress ? ["--address", claims.privateAddress] : []),
      "--machine",
      claims.machineId,
      "--command",
      command,
    ], { env: commonEnv, stdio });
  }
  return spawn("ssh-agent", ["sh", "-c", DIRECT_SSH_SCRIPT], {
    env: {
      ...commonEnv,
      KODY_FLY_ORG: claims.orgSlug || "personal",
      KODY_BRAIN_HOST: brainPrivateHost(claims),
      KODY_BRAIN_COMMAND: command,
    },
    stdio,
  });
}

function spawnBrainAgent(claims) {
  return spawnBrainCommand(claims, "kody-engine brain-terminal-agent --cwd /workspace/repo", ["pipe", "pipe", "pipe"]);
}

function openRequest(claims, afterRevision) {
  return {
    type: "open",
    session: {
      id: claims.chatSessionId,
      scope: {
        owner: claims.owner,
        repo: claims.repo,
        conversationId: claims.conversationId || claims.chatSessionId,
      },
    },
    cwd: "/workspace/repo",
    workspace: claims.workspace,
    afterRevision,
    cols: claims.cols || 120,
    rows: claims.rows || 36,
  };
}

function parseAgentEvent(line, claims) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || event.sessionId !== claims.chatSessionId) return null;
  if (!Number.isInteger(event.generation) || event.generation < 1) return null;
  if (event.type === "state") {
    return ["starting", "ready", "detached", "exited", "failed"].includes(event.state) ? event : null;
  }
  if (event.type === "output") {
    return Number.isInteger(event.revision) && event.revision > 0 && typeof event.data === "string"
      ? event
      : null;
  }
  if (event.type === "input-accepted") {
    return typeof event.inputId === "string" && event.inputId ? event : null;
  }
  if (event.type === "exited") return event;
  if (event.type === "failed") {
    return typeof event.code === "string" && typeof event.message === "string" ? event : null;
  }
  return null;
}

function normalizeCommand(value, claims) {
  if (!value || typeof value !== "object") throw new Error("invalid terminal command");
  if (value.sessionId !== undefined && value.sessionId !== claims.chatSessionId) {
    throw new Error("terminal command session identity mismatch");
  }
  if (value.type === "input") {
    if (typeof value.data !== "string" || !value.data) throw new Error("terminal input missing");
    return {
      type: "input",
      sessionId: claims.chatSessionId,
      inputId: typeof value.inputId === "string" ? value.inputId : String(value.id || ""),
      data: value.data.replace(/\x1b\[<\d+;\d+;\d+[mM]/g, "").replace(/\x1b\[M[\s\S]{3}/g, ""),
    };
  }
  if (value.type === "resize") {
    const cols = Math.min(1000, Math.max(1, Math.floor(Number(value.cols))));
    const rows = Math.min(1000, Math.max(1, Math.floor(Number(value.rows))));
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw new Error("terminal size invalid");
    return { type: "resize", sessionId: claims.chatSessionId, cols, rows };
  }
  if (["attach", "detach", "restart", "clear"].includes(value.type)) {
    return { type: value.type, sessionId: claims.chatSessionId, ...(value.afterRevision !== undefined ? { afterRevision: value.afterRevision } : {}) };
  }
  throw new Error("unknown terminal command");
}

function publicTransportDetail(diagnostics, wasReady) {
  if (/timed? out|context deadline exceeded|ETIMEDOUT/i.test(diagnostics)) {
    return "Fly terminal tunnel timed out.";
  }
  if (/ECONNRESET|connection reset|connection closed/i.test(diagnostics)) {
    return "Fly terminal tunnel closed.";
  }
  return wasReady
    ? "Brain terminal connection closed."
    : "Brain terminal transport is temporarily unavailable.";
}

function attachTerminalSocket(socket, claims) {
  let child = null;
  let stopped = false;
  let retryTimer = null;
  let attemptTimer = null;
  let attempt = 0;
  let afterRevision = Number.isInteger(claims.afterRevision) ? claims.afterRevision : 0;

  const clearAttemptTimer = () => {
    if (!attemptTimer) return;
    clearTimeout(attemptTimer);
    attemptTimer = null;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    clearAttemptTimer();
    if (child?.stdin?.writable) {
      child.stdin.write(JSON.stringify({ type: "detach", sessionId: claims.chatSessionId }) + "\n");
      child.stdin.end();
    }
    try {
      child?.kill("SIGTERM");
    } catch {}
  };

  const scheduleReconnect = (diagnostics) => {
    if (stopped || !socket.writable || retryTimer) return;
    const nextAttempt = attempt + 1;
    const baseDelay = Math.min(
      TERMINAL_UPSTREAM_RETRY_MAX_MS,
      TERMINAL_UPSTREAM_RETRY_BASE_MS * 2 ** Math.min(Math.max(0, attempt - 1), 6),
    );
    const delayMs = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    sendJson(socket, {
      type: "transport-status",
      phase: "reconnecting",
      attempt: nextAttempt,
      retryInMs: delayMs,
      message: "Reconnecting to Brain…",
      ...(diagnostics ? { details: diagnostics.trim().slice(-500) } : {}),
    });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connectUpstream();
    }, delayMs);
  };

  const connectUpstream = () => {
    if (stopped || !socket.writable) return;
    attempt += 1;
    const active = spawnBrainAgent(claims);
    child = active;
    let lines = "";
    let diagnostics = "";
    let ready = false;
    active.stdin.write(JSON.stringify(openRequest(claims, afterRevision)) + "\n");
    attemptTimer = setTimeout(() => {
      diagnostics = diagnostics || "Brain terminal connection timed out";
      try { active.kill("SIGTERM"); } catch {}
    }, TERMINAL_UPSTREAM_ATTEMPT_TIMEOUT_MS);
    active.stdout.on("data", (chunk) => {
      lines += chunk.toString("utf8");
      while (lines.includes("\n")) {
        const index = lines.indexOf("\n");
        const line = lines.slice(0, index).trim();
        lines = lines.slice(index + 1);
        const event = parseAgentEvent(line, claims);
        if (!event) continue;
        if (event.type === "state" && event.state === "ready") {
          ready = true;
          clearAttemptTimer();
        }
        if (event.type === "output") afterRevision = Math.max(afterRevision, event.revision);
        sendJson(socket, event);
      }
    });
    active.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk.toString("utf8")).slice(-2000);
    });
    active.on("error", (error) => {
      diagnostics = error.message;
    });
    active.on("close", () => {
      clearAttemptTimer();
      if (child === active) child = null;
      if (stopped || !socket.writable) return;
      const detail = diagnostics.trim().slice(-500);
      if (/brain-terminal-agent.*(?:not found|unknown command)|(?:not found|unknown command).*brain-terminal-agent/i.test(detail)) {
        sendJson(socket, {
          type: "input-rejected",
          code: "terminal_agent_missing",
          message: "This Brain image needs terminal setup.",
        });
        closeSocket(socket, 1011, "Brain terminal agent missing");
        return;
      }
      scheduleReconnect(publicTransportDetail(detail, ready));
    });
  };

  connectUpstream();

  socket.on("close", stop);
  socket.on("end", stop);
  socket.on("error", stop);
  parseFrames(socket, (text) => {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    if (value.type === "ping") {
      sendJson(socket, { type: "pong" });
      return;
    }
    try {
      const command = normalizeCommand(value, claims);
      if (!child?.stdin?.writable) {
        sendJson(socket, { type: "input-rejected", code: "terminal_transport_reconnecting", inputId: command.inputId, message: "Brain terminal transport is reconnecting" });
        return;
      }
      child.stdin.write(JSON.stringify(command) + "\n");
    } catch (error) {
      sendJson(socket, { type: "input-rejected", message: error instanceof Error ? error.message : "invalid terminal command" });
    }
  });
}

function readRequestJson(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function runCommand(claims, command, local, timeoutMs, maxOutputBytes, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = local ? spawn("/bin/bash", ["-lc", command], {
      env: {
        ...process.env,
        FLY_API_TOKEN: claims.flyToken,
        FLY_ACCESS_TOKEN: claims.flyToken,
        GHCR_TOKEN: claims.ghcrToken || "",
        TERM: "dumb",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }) : spawnBrainCommand(claims, command, ["ignore", "pipe", "pipe"]);
    const stdout = [];
    const stderr = [];
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      finish(reject, new Error("command timed out"));
    }, timeoutMs);
    const capture = (stream, chunks, chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        try { child.kill("SIGTERM"); } catch {}
        finish(reject, new Error("command output too large"));
        return;
      }
      chunks.push(chunk);
      onOutput(stream, decoders[stream].write(chunk));
    };
    child.stdout.on("data", (chunk) => capture("stdout", stdout, chunk));
    child.stderr.on("data", (chunk) => capture("stderr", stderr, chunk));
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) =>
      finish(resolve, {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8").slice(-1024 * 1024),
      }),
    );
  });
}

function execScope(claims, local) {
  return { owner: claims.owner, repo: claims.repo, app: claims.app, machineId: local ? null : claims.machineId, local };
}

function canReadJob(claims, job) {
  return Boolean(
    job &&
      job.scope.owner === claims.owner &&
      job.scope.repo === claims.repo &&
      job.scope.app === claims.app &&
      (job.scope.local ? claims.localExec === true : job.scope.machineId === claims.machineId),
  );
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    code: job.code,
    stdout: job.stdout,
    stderr: job.stderr,
    error: job.error,
  };
}

function startJob(claims, body) {
  const command = typeof body.command === "string" ? body.command : "";
  if (!command.trim() || command.length > 20000) throw new Error("command invalid");
  const local = body.local === true;
  if (local && claims.localExec !== true) throw new Error("local exec not allowed");
  if (!local && claims.localExec === true) throw new Error("local exec token cannot execute on a machine");
  const id = body.jobId ?? crypto.randomBytes(16).toString("hex");
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("job id invalid");
  const previous = execJobs.get(id);
  if (previous) {
    if (!canReadJob(claims, previous)) throw new Error("job not accessible");
    return previous;
  }
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 60000, 1000), MAX_EXEC_TIMEOUT_MS);
  const maxOutputBytes = Math.min(
    Math.max(Number(body.maxOutputBytes) || MAX_EXEC_OUTPUT_BYTES, 1024),
    MAX_EXEC_OUTPUT_BYTES,
  );
  const job = {
    id,
    scope: execScope(claims, local),
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    code: null,
    stdout: "",
    stderr: "",
    error: null,
  };
  execJobs.set(job.id, job);
  runCommand(claims, command, local, timeoutMs, maxOutputBytes, (stream, output) => { job[stream] += output; })
    .then((result) => {
      job.code = result.code;
      job.stdout = result.stdout;
      job.stderr = result.stderr;
      job.status = result.code === 0 ? "completed" : "failed";
      job.error = result.code === 0 ? null : result.stderr.trim().slice(-1000) || "Command failed";
    })
    .catch((error) => {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

function bearerToken(req, url) {
  const auth = req.headers.authorization || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : url.searchParams.get("token");
}

async function queryAgentStatus(claims) {
  return new Promise((resolve, reject) => {
    const child = spawnBrainAgent(claims);
    let lines = "";
    let diagnostics = "";
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      if (!settled) {
        settled = true;
        reject(new Error("terminal status timed out"));
      }
    }, AGENT_STATUS_TIMEOUT_MS);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.stdout.on("data", (chunk) => {
      lines += chunk.toString("utf8");
      while (lines.includes("\n")) {
        const index = lines.indexOf("\n");
        const event = parseAgentEvent(lines.slice(0, index).trim(), claims);
        lines = lines.slice(index + 1);
        if (!event) continue;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.end();
        resolve(event);
        return;
      }
    });
    child.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (settled) return;
      fail(new Error(diagnostics.trim() || "terminal agent exited with code " + (code ?? 1)));
    });
    child.stdin.end(JSON.stringify({ type: "status", sessionId: claims.chatSessionId }) + "\n");
  });
}

function safeDiagnostic(message) {
  return String(message).replace(/FlyV1[^\s"']+/g, "[redacted-token]").slice(0, 500);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of execJobs) {
    const finished = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
    if (Number.isFinite(finished) && now - finished > EXEC_JOB_TTL_MS) execJobs.delete(id);
  }
}, 60000).unref?.();

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") return jsonResponse(res, 200, { ok: true });
  try {
    const url = new URL(req.url || "/", "http://terminal-bridge.internal");
    const claims = verifyTerminalToken(bearerToken(req, url));
    if (url.pathname === "/status" && req.method === "GET") {
      if (claims.localExec === true) throw new Error("local exec token cannot query a terminal");
      const event = await queryAgentStatus(claims);
      return jsonResponse(res, 200, {
        ok: true,
        alive: event.type === "state" && (event.state === "ready" || event.state === "detached"),
        ready: event.type === "state" && event.state === "ready",
        generation: event.generation,
        processId: event.processId ?? null,
        revision: event.revision ?? null,
      });
    }
    if (url.pathname === "/exec" && req.method === "POST") {
      const body = await readRequestJson(req);
      const job = startJob(claims, body);
      res.writeHead(200, { "content-type": "application/json" });
      const keepalive = setInterval(() => res.write(" "), EXEC_KEEPALIVE_INTERVAL_MS);
      const wait = setInterval(() => {
        if (job.status === "running") return;
        clearInterval(wait);
        clearInterval(keepalive);
        res.end(JSON.stringify({ ok: job.status === "completed", ...publicJob(job) }));
      }, 50);
      return;
    }
    if (url.pathname === "/jobs" && req.method === "POST") {
      const job = startJob(claims, await readRequestJson(req));
      return jsonResponse(res, 202, { ok: true, job: publicJob(job) });
    }
    if (url.pathname.startsWith("/jobs/") && req.method === "GET") {
      const id = url.pathname.slice("/jobs/".length);
      const job = /^[a-f0-9]{32}$/.test(id) ? execJobs.get(id) : null;
      return canReadJob(claims, job)
        ? jsonResponse(res, 200, { ok: true, job: publicJob(job) })
        : jsonResponse(res, 404, { ok: false, error: "job not found" });
    }
    return jsonResponse(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unauthorized";
    const authenticationFailure = /token|unauthorized|forbidden|local exec/i.test(message);
    return jsonResponse(
      res,
      authenticationFailure ? 401 : 503,
      {
        ok: false,
        error: authenticationFailure ? "unauthorized" : "terminal_transport_unavailable",
        message: safeDiagnostic(message),
      },
    );
  }
});

server.on("upgrade", (req, socket) => {
  try {
    const url = new URL(req.url || "/", "http://terminal-bridge.internal");
    const claims = verifyTerminalToken(url.searchParams.get("token"));
    if (claims.localExec === true) throw new Error("local exec token cannot open a terminal");
    const key = req.headers["sec-websocket-key"];
    if (!key) throw new Error("missing websocket key");
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    attachTerminalSocket(socket, claims);
  } catch (error) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
    socket.destroy();
  }
});

server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => {
  console.log("stateless terminal gateway listening");
});
`;
