import crypto from "node:crypto";
import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { waitForAppVerification } from "../../builder/src/app-verification";

const processes: ChildProcess[] = [];
afterEach(() => processes.splice(0).forEach((child) => child.kill("SIGTERM")));

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    ),
  );
}

describe("app deployment verification", () => {
  it("checks the configured path through the authenticated gateway", async () => {
    const upstream = http.createServer((request, response) => {
      if (request.url === "/api/config") {
        response.statusCode = 307;
        response.setHeader("location", "/api/config/");
      } else response.statusCode = request.url === "/api/config/" ? 200 : 404;
      response.end("ok");
    });
    const upstreamPort = await listen(upstream);
    const probe = http.createServer();
    const port = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const key = crypto.randomBytes(32);
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
          KODY_APP_TOKEN_HASHES: crypto
            .createHash("sha256")
            .update("unused-token")
            .digest("hex"),
          KODY_APP_REPOSITORY: "acme/site",
          KODY_APP_ID: "app-id",
          KODY_APP_LAUNCH_VERIFY_KEY: key.toString("hex"),
        },
        stdio: "ignore",
      },
    );
    processes.push(child);

    await expect(
      waitForAppVerification({
        origin: `http://127.0.0.1:${port}`,
        verification: { path: "/api/config", expectedStatus: 200 },
        privateAccess: {
          repository: "acme/site",
          appId: "app-id",
          verifyKey: key,
        },
        attempts: 20,
        retryDelayMs: 25,
      }),
    ).resolves.toBeUndefined();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("rejects a verification URL that can leave the deployed app", async () => {
    await expect(
      waitForAppVerification({
        origin: "https://app.example.com",
        verification: {
          path: "https://attacker.example/",
          expectedStatus: 200,
        },
        attempts: 1,
      }),
    ).rejects.toThrow("APP_VERIFICATION_INVALID_PATH");
  });

  it("does not follow a cross-origin redirect", async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "https://attacker.example/");
      response.end();
    });
    const port = await listen(server);
    await expect(
      waitForAppVerification({
        origin: `http://127.0.0.1:${port}`,
        verification: { path: "/ready", expectedStatus: 200 },
        attempts: 1,
      }),
    ).rejects.toThrow("APP_VERIFICATION_UNSAFE_REDIRECT");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("fails when the application never returns the expected status", async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 503;
      response.end("not ready");
    });
    const port = await listen(server);
    await expect(
      waitForAppVerification({
        origin: `http://127.0.0.1:${port}`,
        verification: { path: "/ready", expectedStatus: 200 },
        attempts: 2,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("APP_VERIFICATION_FAILED: HTTP 503");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
