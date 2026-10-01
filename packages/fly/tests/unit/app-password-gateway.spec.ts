import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
async function ready(url: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  throw new Error("Gateway did not start");
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

describe("Fly Hub app password gateway", () => {
  it("blocks the app until the shared password is entered", async () => {
    const upstream = http.createServer((_req, res) => res.end("private app"));
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const targetPort = (upstream.address() as net.AddressInfo).port;
    const port = await freePort();
    const password = "a-strong-generated-password";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        resolve(import.meta.dirname, "../../builder/app-doorman/doorman.ts"),
      ],
      {
        cwd: resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          PORT: String(port),
          APP_TARGET_HOST: "127.0.0.1",
          APP_INTERNAL_PORT: String(targetPort),
          FLY_HUB_PASSWORD_HASH: crypto
            .createHash("sha256")
            .update(password)
            .digest("hex"),
        },
        stdio: "ignore",
      },
    );
    children.push(child);
    try {
      const origin = `http://127.0.0.1:${port}`;
      await ready(origin);
      const blocked = await fetch(origin);
      expect(blocked.status).toBe(401);
      expect(await blocked.text()).toContain("password protected");
      const wrong = await fetch(`${origin}/_flyhub/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "password=wrong",
        redirect: "manual",
      });
      expect(wrong.status).toBe(401);
      const login = await fetch(`${origin}/_flyhub/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password }),
        redirect: "manual",
      });
      expect(login.status).toBe(303);
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeTruthy();
      const opened = await fetch(origin, { headers: { cookie: cookie! } });
      expect(opened.status).toBe(200);
      expect(await opened.text()).toBe("private app");
    } finally {
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });
});

it("preserves the app's Bearer and Basic login over HTTP and WebSocket while removing gateway credentials", async () => {
  const outerToken = "kody_app_outer_token",
    innerToken = "inner-api-token";
  const upstream = http.createServer((req, res) => {
    const expected =
      req.url === "/api/basic" ? "Basic dXNlcjpwYXNz" : `Bearer ${innerToken}`;
    if (req.url !== "/headers" && req.headers.authorization !== expected) {
      res.writeHead(401);
      res.end("inner login missing");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.headers));
  });
  upstream.on("upgrade", (req, socket) => {
    if (
      req.headers.authorization !== `Bearer ${innerToken}` ||
      req.headers.cookie !== "inner_session=app-cookie"
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(
        String(req.headers["sec-websocket-key"]) +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n" +
        "authorized",
    );
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  const targetPort = (upstream.address() as net.AddressInfo).port,
    port = await freePort(),
    password = "outer-login-password";
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      resolve(import.meta.dirname, "../../builder/app-doorman/doorman.ts"),
    ],
    {
      env: {
        ...process.env,
        PORT: String(port),
        APP_TARGET_HOST: "127.0.0.1",
        APP_INTERNAL_PORT: String(targetPort),
        APP_API_INTERNAL_PORT: String(targetPort),
        KODY_APP_EXPOSURE: "private",
        KODY_APP_TOKEN_HASHES: crypto
          .createHash("sha256")
          .update(outerToken)
          .digest("hex"),
        FLY_HUB_PASSWORD_HASH: crypto
          .createHash("sha256")
          .update(password)
          .digest("hex"),
      },
      stdio: "ignore",
    },
  );
  children.push(child);
  try {
    const origin = `http://127.0.0.1:${port}`;
    await ready(origin);
    expect(
      (
        await fetch(origin + "/api/basic", {
          headers: { authorization: "Basic dXNlcjpwYXNz" },
        })
      ).status,
    ).toBe(401);
    const login = await fetch(origin + "/_flyhub/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password }),
      redirect: "manual",
    });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    for (const [path, authorization] of [
      ["/api/bearer", `Bearer ${innerToken}`],
      ["/api/basic", "Basic dXNlcjpwYXNz"],
    ]) {
      const response = await fetch(origin + path, {
        headers: {
          authorization,
          cookie: cookie + "; inner_session=app-cookie",
        },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        authorization,
        cookie: "inner_session=app-cookie",
      });
    }
    const dual = await fetch(origin + "/api/bearer", {
      headers: {
        authorization: `Bearer ${innerToken}`,
        "x-kody-app-token": outerToken,
      },
    });
    expect(dual.status).toBe(200);
    const dualHeaders = await dual.json();
    expect(dualHeaders.authorization).toBe(`Bearer ${innerToken}`);
    expect(dualHeaders["x-kody-app-token"]).toBeUndefined();
    const outer = await fetch(origin + "/headers", {
      headers: {
        authorization: `Bearer ${outerToken}`,
        cookie: cookie + "; inner_session=app-cookie",
      },
    });
    expect(await outer.json()).toMatchObject({
      cookie: "inner_session=app-cookie",
    });
    const result = await new Promise<string>((resolvePromise, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/live",
        headers: {
          authorization: `Bearer ${innerToken}`,
          cookie: cookie + "; inner_session=app-cookie",
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": crypto.randomBytes(16).toString("base64"),
          "sec-websocket-version": "13",
        },
      });
      request.on("upgrade", (response, socket, head) => {
        expect(response.statusCode).toBe(101);
        if (head.length) {
          socket.destroy();
          resolvePromise(head.toString());
        } else
          socket.once("data", (data) => {
            socket.destroy();
            resolvePromise(data.toString());
          });
      });
      request.on("response", (response) => {
        response.resume();
        reject(new Error(`Upgrade HTTP ${response.statusCode}`));
      });
      request.on("error", reject);
      request.setTimeout(2000, () =>
        request.destroy(new Error("Upgrade timed out")),
      );
      request.end();
    });
    expect(result).toBe("authorized");
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
  }
});
