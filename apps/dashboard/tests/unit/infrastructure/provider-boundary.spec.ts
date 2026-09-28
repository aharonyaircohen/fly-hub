import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function listSourceFiles(dir: string): string[] {
  const abs = resolve(repoRoot, dir);
  return readdirSync(abs).flatMap((entry) => {
    const child = resolve(abs, entry);
    const rel = relative(repoRoot, child);
    if (rel.startsWith("node_modules/@kody-ade/fly/src/plugin")) {
      return [];
    }
    if (statSync(child).isDirectory()) return listSourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry) ? [rel] : [];
  });
}

describe("infrastructure provider boundary", () => {
  it("keeps the generic registry free of vendor plugin imports", () => {
    const registry = readRepoFile(
      "../../packages/base/src/infrastructure/registry.ts",
    );

    expect(registry).not.toContain("/plugins/fly");
    expect(registry).not.toContain("flyInfrastructure");
  });

  it("keeps migrated runtime callers from selecting Fly directly", () => {
    const migratedCallers = [
      "app/api/kody/chat/interactive/start/route.ts",
      "app/api/kody/chat/interactive/start-fly/route.ts",
      "app/api/kody/vibe/execute/route.ts",
      "node_modules/@kody-ade/fly/src/runners/kody-runner.ts",
      "node_modules/@kody-ade/fly/src/runners/runner-dispatch.ts",
      "node_modules/@kody-ade/fly/src/runners/runner-router.ts",
      "node_modules/@kody-ade/fly/src/runners/server-run.ts",
      "node_modules/@kody-ade/fly/src/previews/preview-lifecycle.ts",
    ];

    for (const file of migratedCallers) {
      const source = readRepoFile(file);
      expect(source).not.toContain('getServerProvider("fly"');
      expect(source).not.toContain('getDeploymentProvider("fly"');
      expect(source).not.toContain("flyComputeProvider");
      expect(source).not.toContain("resolveFlyContext");
      expect(source).not.toContain("claimOrSpawnFly");
      expect(source).not.toContain("flyAvailable");
      expect(source).not.toContain("runFly");
      expect(source).not.toContain("flyResult");
      expect(source).not.toContain("@kody-ade/fly/plugin");
      expect(source).not.toContain("@kody-ade/fly/infrastructure/providers/fly");
    }
  });

  it("keeps Fly provider code inside the plugin directory", () => {
    const installed = readRepoFile("node_modules/@kody-ade/fly/src/infrastructure/installed.ts");

    expect(installed).toContain('from "../plugin"');
    expect(() =>
      readRepoFile("node_modules/@kody-ade/fly/src/infrastructure/providers/fly/compute.ts"),
    ).toThrow();
  });

  it("keeps app and core code from importing Fly plugin modules directly", () => {
    const allowed = new Set(["node_modules/@kody-ade/fly/src/infrastructure/installed.ts"]);
    const files = [...listSourceFiles("app"), ...listSourceFiles("src")].filter(
      (file) => !allowed.has(file),
    );

    for (const file of files) {
      const source = readRepoFile(file);
      expect(source, file).not.toContain(
        "@kody-ade/fly/plugin",
      );
      expect(source, file).not.toContain("@kody-ade/fly/runners/fly");
      expect(source, file).not.toContain("@kody-ade/fly/previews/fly");
      expect(source, file).not.toContain("@kody-ade/terminal/bridge-fly");
    }
  });
});
