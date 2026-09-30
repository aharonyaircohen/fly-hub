import crypto from "node:crypto";
import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const targetPort = Number.parseInt(process.env.APP_INTERNAL_PORT ?? "3000", 10);
const apiTargetPort = Number.parseInt(
  process.env.APP_API_INTERNAL_PORT ?? String(targetPort),
  10,
);
const targetHost = process.env.APP_TARGET_HOST ?? "127.0.0.1";
const isPublic = process.env.KODY_APP_EXPOSURE === "public";
const hashes = new Set(
  (process.env.KODY_APP_TOKEN_HASHES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[a-f0-9]{64}$/.test(value)),
);
// Fly Hub uses one generated, high-entropy password per app. Only its hash is
// passed to this machine. Changing the hash invalidates existing sessions.
const flyHubPasswordHash = process.env.FLY_HUB_PASSWORD_HASH ?? "";
const hasFlyHubPassword = /^[a-f0-9]{64}$/.test(flyHubPasswordHash);
const flyHubCookie = "flyhub_app_session";
const sessionSeconds = 60 * 60 * 24 * 7;
const attempts = new Map<string, { count: number; until: number }>();
function passwordSession(): string {
  const expiry = Math.floor(Date.now() / 1000) + sessionSeconds;
  const signature = crypto
    .createHmac("sha256", flyHubPasswordHash)
    .update(String(expiry))
    .digest("hex");
  return `${expiry}.${signature}`;
}
function validPasswordSession(value: string): boolean {
  if (!hasFlyHubPassword) return false;
  const match = value.match(/^(\d{10})\.([a-f0-9]{64})$/);
  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac("sha256", flyHubPasswordHash)
    .update(match[1])
    .digest();
  const actual = Buffer.from(match[2], "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
function passwordMatches(value: string): boolean {
  if (!hasFlyHubPassword) return false;
  const expected = Buffer.from(flyHubPasswordHash, "hex");
  const actual = crypto.createHash("sha256").update(value, "utf8").digest();
  return crypto.timingSafeEqual(actual, expected);
}
function loginPage(error = false): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>App access</title><style>body{font:16px system-ui;background:#f7f8fb;color:#18212f;min-height:100vh;display:grid;place-items:center;margin:0}main{background:white;padding:2rem;border:1px solid #dce2eb;border-radius:16px;width:min(360px,calc(100vw - 3rem));box-shadow:0 12px 36px #17203312}h1{font-size:1.4rem}label{display:block;margin:1.5rem 0 .4rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;border-radius:8px;font:inherit}input{border:1px solid #b8c2d1}button{margin-top:1rem;border:0;background:#173a76;color:white;cursor:pointer}.error{color:#b42318}</style><main><h1>This app is password protected</h1><p>Enter the password shared by the app owner.</p>${error ? '<p class="error" role="alert">Incorrect password. Try again.</p>' : ""}<form method="post" action="/_flyhub/login"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button>Open app</button></form></main></html>`;
}
const repository = process.env.KODY_APP_REPOSITORY ?? "",
  appId = process.env.KODY_APP_ID ?? "",
  launchKeyRaw = process.env.KODY_APP_LAUNCH_VERIFY_KEY ?? "";
const launchKey = /^[a-f0-9]{64}$/i.test(launchKeyRaw)
  ? Buffer.from(launchKeyRaw, "hex")
  : null;
const cookieName = "kody_app_session";
function verifyLaunch(ticket: string) {
  if (!launchKey) return false;
  try {
    const value = JSON.parse(
      Buffer.from(ticket, "base64url").toString("utf8"),
    ) as { r?: unknown; a?: unknown; e?: unknown; s?: unknown };
    if (
      value.r !== repository ||
      value.a !== appId ||
      typeof value.e !== "number" ||
      typeof value.s !== "string" ||
      Math.floor(Date.now() / 1000) >= value.e
    )
      return false;
    const expected = crypto
        .createHmac("sha256", launchKey)
        .update(`${repository}:${appId}:${value.e}`)
        .digest("hex")
        .slice(0, 32),
      a = Buffer.from(value.s, "hex"),
      b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
function cookie(req: http.IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [index, value] = part.trim().split("=");
    if (index === name) return value ?? "";
  }
  return "";
}

function tokenFrom(req: http.IncomingMessage): string {
  const authorization = req.headers.authorization ?? "";
  if (/^Bearer\s+/i.test(authorization))
    return authorization.replace(/^Bearer\s+/i, "").trim();
  const header = req.headers["x-kody-app-token"];
  return Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
}

function authorized(req: http.IncomingMessage): boolean {
  if (isPublic) return true;
  if (hasFlyHubPassword && validPasswordSession(cookie(req, flyHubCookie)))
    return true;
  if (verifyLaunch(cookie(req, cookieName))) return true;
  const token = tokenFrom(req);
  if (!token) return false;
  const actual = crypto.createHash("sha256").update(token).digest();
  for (const hash of hashes) {
    const expected = Buffer.from(hash, "hex");
    if (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    )
      return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost"),
    launch = url.searchParams.get("ka");
  if (url.pathname === "/_kody/health") {
    const upstream = http.get(
      { hostname: targetHost, port: targetPort, path: "/" },
      (response) => {
        response.resume();
        res.writeHead((response.statusCode ?? 500) < 500 ? 200 : 503, {
          "cache-control": "no-store",
        });
        res.end();
      },
    );
    upstream.on("error", () => {
      res.writeHead(503, { "cache-control": "no-store" });
      res.end();
    });
    return;
  }
  if (
    hasFlyHubPassword &&
    url.pathname === "/_flyhub/login" &&
    req.method === "POST"
  ) {
    const ip =
      req.headers["fly-client-ip"]?.toString() ??
      req.socket.remoteAddress ??
      "unknown";
    const now = Date.now();
    const rate = attempts.get(ip);
    if (rate && rate.until > now && rate.count >= 10) {
      res.writeHead(429, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(loginPage(true));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => {
      const password = new URLSearchParams(body).get("password") ?? "";
      if (!passwordMatches(password)) {
        attempts.set(ip, {
          count: rate && rate.until > now ? rate.count + 1 : 1,
          until: now + 15 * 60_000,
        });
        res.writeHead(401, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(loginPage(true));
        return;
      }
      attempts.delete(ip);
      res.writeHead(303, {
        location: "/",
        "set-cookie": `${flyHubCookie}=${passwordSession()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionSeconds}`,
        "cache-control": "no-store",
      });
      res.end();
    });
    return;
  }
  if (hasFlyHubPassword && url.pathname === "/_flyhub/logout") {
    res.writeHead(303, {
      location: "/",
      "set-cookie": `${flyHubCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      "cache-control": "no-store",
    });
    res.end();
    return;
  }
  if (launch) {
    if (!verifyLaunch(launch)) {
      res.writeHead(401, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ error: "invalid_app_launch_ticket" }));
      return;
    }
    url.searchParams.delete("ka");
    res.writeHead(302, {
      location: `${url.pathname}${url.search}`,
      "set-cookie": `${cookieName}=${launch}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
    return;
  }
  if (!authorized(req)) {
    if (
      hasFlyHubPassword &&
      req.method === "GET" &&
      !(req.headers.accept ?? "").includes("application/json")
    ) {
      res.writeHead(401, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(loginPage());
      return;
    }
    res.writeHead(401, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ error: "app_access_token_required" }));
    return;
  }
  const headers = {
    ...req.headers,
    "x-forwarded-proto": "https",
    "x-forwarded-host": req.headers.host ?? "",
  };
  delete headers.authorization;
  delete headers["x-kody-app-token"];
  const upstream = http.request(
    {
      hostname: targetHost,
      port:
        url.pathname === "/api" || url.pathname.startsWith("/api/")
          ? apiTargetPort
          : targetPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, clientSocket, head) => {
  if (!authorized(req)) {
    clientSocket.end(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = {
    ...req.headers,
    "x-forwarded-proto": "https",
    "x-forwarded-host": req.headers.host ?? "",
  };
  delete headers.authorization;
  delete headers["x-kody-app-token"];
  const upstream = http.request({
    hostname: targetHost,
    port:
      url.pathname === "/api" || url.pathname.startsWith("/api/")
        ? apiTargetPort
        : targetPort,
    path: req.url,
    method: req.method,
    headers,
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    clientSocket.write(
      `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n` +
        response.rawHeaders.reduce(
          (lines, value, index, all) =>
            index % 2 === 0 ? lines + `${value}: ${all[index + 1]}\r\n` : lines,
          "",
        ) +
        "\r\n",
    );
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) clientSocket.write(upstreamHead);
    clientSocket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => clientSocket.destroy());
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });
  upstream.on("response", (response) => {
    clientSocket.write(
      `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n` +
        response.rawHeaders.reduce(
          (lines, value, index, all) =>
            index % 2 === 0 ? lines + `${value}: ${all[index + 1]}\r\n` : lines,
          "",
        ) +
        "\r\n",
    );
    response.pipe(clientSocket);
  });
  upstream.on("error", () => {
    if (!clientSocket.destroyed)
      clientSocket.end(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
  });
  clientSocket.on("error", () => upstream.destroy());
  upstream.end();
});

server.listen(port, "0.0.0.0");
