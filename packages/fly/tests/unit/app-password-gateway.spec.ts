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
