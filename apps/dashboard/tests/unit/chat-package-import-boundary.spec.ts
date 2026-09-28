import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        files.push(...sourceFiles(path));
      }
    } else if (sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function filesContaining(root: string, pattern: RegExp): string[] {
  return sourceFiles(root)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(repositoryRoot.length + 1));
}

describe("chat package import boundaries", () => {
  it("uses declared package exports instead of the legacy deep alias", () => {
    const dashboardRoot = resolve(repositoryRoot, "apps/dashboard");
    const tsconfig = JSON.parse(
      readFileSync(join(dashboardRoot, "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { paths?: Record<string, string[]> } };

    expect(tsconfig.compilerOptions?.paths).not.toHaveProperty("@kody-chat/*");
    expect(
      filesContaining(dashboardRoot, /(?:from|import\()\s*["']@kody-chat\//),
    ).toEqual([]);
  });

  it("does not make the private integration import Dashboard source aliases", () => {
    const integrationRoot = resolve(
      repositoryRoot,
      "packages/kody-chat-dashboard",
    );

    expect(
      filesContaining(integrationRoot, /(?:from|import\()\s*["']@dashboard(?:\/|["'])/),
    ).toEqual([]);
  });

  it("keeps the public package independent from private workspace packages", () => {
    const publicPackage = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "packages/kody-chat/package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    const publicSource = resolve(repositoryRoot, "packages/kody-chat/src");

    expect(publicPackage.dependencies ?? {}).toEqual({});
    expect(
      filesContaining(publicSource, /@kody-ade\/(?:kody-chat-dashboard|agency|backend|base|brain|cms|fly|terminal|workspace)/),
    ).toEqual([]);
  });
});
