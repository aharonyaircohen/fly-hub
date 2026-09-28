import crypto from "node:crypto";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const processes: ChildProcess[] = [];
afterEach(() => processes.splice(0).forEach((child) => child.kill("SIGTERM")));

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    ),
  );
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("doorman did not start");
}

describe("private App gateway", () => {
  it("requires a token, strips credentials, and accepts a short-lived launch ticket", async () => {
    let upstreamHeaders: http.IncomingHttpHeaders = {};
    const upstream = http.createServer((request, response) => {
      upstreamHeaders = request.headers;
      response.end("ok");
    });
    const upstreamPort = await listen(upstream);
    const probe = http.createServer();
    const port = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const token = "kody_app_test_secret",
      tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const key = crypto.randomBytes(32),
      repository = "acme/site",
      appId = "app-id";
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        new URL("../../builder/app-doorman/doorman.ts", import.meta.url)
          .pathname,
      ],
      {
        env: {
          ...process.env,
          PORT: String(port),
          APP_INTERNAL_PORT: String(upstreamPort),
          APP_API_INTERNAL_PORT: String(upstreamPort),
          APP_TARGET_HOST: "127.0.0.1",
          KODY_APP_EXPOSURE: "private",
          KODY_APP_TOKEN_HASHES: tokenHash,
          KODY_APP_REPOSITORY: repository,
          KODY_APP_ID: appId,
          KODY_APP_LAUNCH_VERIFY_KEY: key.toString("hex"),
        },
        stdio: "ignore",
      },
    );
    processes.push(child);
    await waitFor(`http://127.0.0.1:${port}/health`);

    expect(
      (await fetch(`http://127.0.0.1:${port}/_kody/health`)).status,
    ).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401);
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    expect(upstreamHeaders.authorization).toBeUndefined();
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/api/health`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    const expiry = Math.floor(Date.now() / 1000) + 60;
    const signature = crypto
      .createHmac("sha256", key)
      .update(`${repository}:${appId}:${expiry}`)
      .digest("hex")
      .slice(0, 32);
    const ticket = Buffer.from(
      JSON.stringify({ r: repository, a: appId, e: expiry, s: signature }),
    ).toString("base64url");
    const launch = await fetch(`http://127.0.0.1:${port}/?ka=${ticket}`, {
      redirect: "manual",
    });
    expect(launch.status).toBe(302);
    expect(launch.headers.get("set-cookie")).toContain("HttpOnly");
    expect(launch.headers.get("location")).toBe("/");
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});
