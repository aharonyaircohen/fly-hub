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
      port: url.pathname === "/api" || url.pathname.startsWith("/api/")
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

server.listen(port, "0.0.0.0");
