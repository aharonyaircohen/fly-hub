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
  "../brain/src/routes/provision.ts",
  "../brain/src/routes/login.ts",
  "../brain/src/routes/status.ts",
  "../brain/src/routes/destroy.ts",
  "../brain/src/routes/stored.ts",
  "../brain/src/routes/suspend.ts",
  "../brain/src/routes/resume.ts",
];

describe("Brain Fly route ownership", () => {
  it("resolves personal ownership without installing repository context", () => {
    for (const routePath of STATEFUL_ROUTES) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("resolvePersonalBrainContext(");
      expect(source, routePath).not.toContain("setGitHubContext(");
      expect(source, routePath).not.toContain("ctx.context.storeRepoUrl");
    }
  });

  it("keeps repository content context separate in the chat proxy", () => {
    const source = readRoute("app/api/kody/chat/brain-fly/route.ts");
    expect(source).toContain("resolvePersonalBrainContext(");
    expect(source).toContain("resolveServerProviderContext(req)");
    expect(source).toContain("repoContext.context.storeRepoUrl");
    expect(source).toContain("clearGitHubContext()");
  });

  it("uses the resolved Brain service for every machine control route", () => {
    const commandSource = readRoute("../brain/src/server-commands.ts");
    expect(commandSource).toContain("resolveBrainService(");
    expect(commandSource).toContain("appNameOverride: brain.app");
    for (const routePath of [
      "../brain/src/routes/destroy.ts",
      "../brain/src/routes/suspend.ts",
      "../brain/src/routes/resume.ts",
    ]) {
      const source = readRoute(routePath);
      expect(source, routePath).toContain("manageBrainServer(");
    }
  });
});
