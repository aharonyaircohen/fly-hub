import { describe, expect, it } from "vitest";
import {
  detectAppSource,
  detectAppVerification,
  detectRuntimeEnvironment,
  detectRequiredSecretNames,
  generateFlyAppName,
} from "../../src/apps/source-detector";

describe("detectAppVerification", () => {
  it("uses the application's own connection check when one is present", () => {
    expect(
      detectAppVerification([
        {
          path: "frontend/src/lib/config.ts",
          text: "await fetch(`${baseUrl}/api/config`)",
        },
        { path: "api/main.py", text: '@app.get("/health")' },
      ]),
    ).toEqual({ path: "/api/config", expectedStatus: 200 });
  });

  it("falls back to the user-facing root for an ordinary web app", () => {
    expect(detectAppVerification([])).toEqual({
      path: "/",
      expectedStatus: 200,
    });
  });
});

describe("detectAppSource", () => {
  it("prefers an explicit Dockerfile over framework inference", () => {
    const result = detectAppSource({
      files: ["Dockerfile", "package.json", "pnpm-lock.yaml"],
      readText: (path) =>
        path === "Dockerfile"
          ? 'EXPOSE 8080\nCMD ["node", "server.js"]'
          : '{"scripts":{"start":"next start"}}',
    });
    expect(result).toMatchObject({
      kind: "dockerfile",
      rootDirectory: ".",
      port: 8080,
    });
  });

  it("detects a monorepo application at its selected root", () => {
    const result = detectAppSource({
      rootDirectory: "apps/web",
      files: [
        "package.json",
        "pnpm-lock.yaml",
        "apps/web/package.json",
        "apps/web/next.config.mjs",
      ],
      readText: (path) =>
        path === "apps/web/package.json"
          ? '{"scripts":{"build":"next build","start":"next start -p 4000"},"dependencies":{"next":"15.0.0"}}'
          : "{}",
    });
    expect(result).toMatchObject({
      kind: "next",
      rootDirectory: "apps/web",
      buildCommand: "pnpm build",
      startCommand: "pnpm start",
      port: 4000,
    });
  });

  it("normalizes an existing fly.toml build and service", () => {
    expect(
      detectAppSource({
        files: ["fly.toml"],
        readText: () =>
          `[build]\n image = "ghcr.io/acme/api:v1"\n[http_service]\n internal_port = 9000`,
      }),
    ).toMatchObject({
      kind: "fly",
      imageRef: "ghcr.io/acme/api:v1",
      port: 9000,
    });
  });

  it("returns actionable ambiguity instead of guessing", () => {
    expect(
      detectAppSource({ files: ["README.md"], readText: () => "" }),
    ).toEqual({
      kind: "unsupported",
      rootDirectory: ".",
      questions: [
        "Which directory contains the application and how should it be started?",
      ],
    });
  });
});

describe("generateFlyAppName", () => {
  it("is deterministic, Fly-safe, and collision-resistant across owners", () => {
    expect(generateFlyAppName("Acme/Web_App", "Public API")).toMatch(
      /^kody-app-acme-web-app-public-api-[a-f0-9]{8}$/,
    );
    expect(generateFlyAppName("acme/web-app", "public-api")).not.toBe(
      generateFlyAppName("other/web-app", "public-api"),
    );
    expect(generateFlyAppName("acme/web-app", "public-api")).toBe(
      generateFlyAppName("acme/web-app", "public-api"),
    );
  });
});

it("detects runtime secret names without treating public config as secret", () => {
  expect(
    detectRequiredSecretNames([
      {
        path: ".env.example",
        text: "DATABASE_URL=\nNEXT_PUBLIC_URL=\nAPI_KEY=placeholder",
      },
      { path: "src/server.ts", text: "process.env.SESSION_SECRET" },
    ]),
  ).toEqual(["DATABASE_URL"]);
});

it("separates usable defaults and generated secrets from user-provided secrets", () => {
  expect(
    detectRuntimeEnvironment([
      {
        path: ".env.example",
        text: [
          "OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string",
          "SURREAL_USER=root",
          "SURREAL_PASSWORD=root",
          "SURREAL_URL=ws://surrealdb:8000/rpc",
          "# API_URL=http://localhost:5055",
        ].join("\n"),
      },
    ]),
  ).toEqual({
    requiredSecretNames: [],
    generatedSecretNames: ["OPEN_NOTEBOOK_ENCRYPTION_KEY"],
    runtimeEnv: {
      SURREAL_PASSWORD: "root",
      SURREAL_URL: "ws://surrealdb:8000/rpc",
      SURREAL_USER: "root",
    },
  });
});

it("prefers a Docker target explicitly named single for one-Machine hosting", () => {
  expect(
    detectAppSource({
      files: ["Dockerfile"],
      readText: () =>
        "FROM python:3.12 AS runtime\n# Set API_URL for reverse proxies\nEXPOSE 8502 5055\nFROM runtime AS single\nCMD run",
    }),
  ).toMatchObject({
    kind: "dockerfile",
    port: 8502,
    apiPort: 5055,
    dockerBuildTarget: "single",
  });
});
