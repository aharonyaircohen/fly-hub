/**
 * @fileoverview Regression guards for Brain Fly routes that touch repo state.
 * @testFramework vitest
 * @domain brain
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function readRoute(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const STATEFUL_ROUTES = [
  "../../packages/brain/src/routes/provision.ts",
  "../../packages/brain/src/routes/login.ts",
  "../../packages/brain/src/routes/status.ts",
  "../../packages/brain/src/routes/destroy.ts",
  "../../packages/brain/src/routes/stored.ts",
  "../../packages/brain/src/routes/suspend.ts",
  "../../packages/brain/src/routes/resume.ts",
  "app/api/kody/chat/brain-fly/route.ts",
];

const HOSTED_BRAIN_ROUTES = [
  "app/api/kody/brain/provision/route.ts",
  "app/api/kody/brain/destroy/route.ts",
  "app/api/kody/brain/resume/route.ts",
  "app/api/kody/brain/suspend/route.ts",
  "app/api/kody/brain/models/route.ts",
  "app/api/kody/brain/status/route.ts",
  "app/api/kody/brain/image/route.ts",
  "app/api/kody/brain/image/apply/route.ts",
  "app/api/kody/brain/image/worker/route.ts",
  "app/api/kody/brain/login/route.ts",
  "app/api/kody/brain/suspension/route.ts",
  "app/api/kody/brain/stored/route.ts",
  "app/api/kody/chat/brain-fly/route.ts",
];

describe("Personal Brain route context", () => {
  it("registers host services inside every serverless route bundle", () => {
    for (const routePath of HOSTED_BRAIN_ROUTES) {
      expect(readRoute(routePath), routePath).toMatch(
        /import(?:\s+[^;]+\s+from)?\s+"@dashboard\/lib\/brain\/personal-services";/,
      );
    }
  });

  it("does not require repository context for Brain lifecycle state", () => {
    for (const routePath of STATEFUL_ROUTES.slice(0, -1)) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("resolvePersonalBrainContext");
      expect(source, routePath).not.toContain("resolveServerProviderContext");
      expect(source, routePath).not.toContain("setGitHubContext(");
    }
  });

  it("uses the resolved Brain service for every machine control route", () => {
    const commandSource = readRoute(
      "../../packages/brain/src/server-commands.ts",
    );
    expect(commandSource).toContain("resolveBrainService(");
    expect(commandSource).toContain("appNameOverride: brain.app");
    for (const routePath of [
      "../../packages/brain/src/routes/destroy.ts",
      "../../packages/brain/src/routes/suspend.ts",
      "../../packages/brain/src/routes/resume.ts",
    ]) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("manageBrainServer(");
    }
  });
});
