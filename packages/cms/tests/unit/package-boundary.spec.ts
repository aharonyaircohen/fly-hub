import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("CMS package boundary", () => {
  it("does not depend on the concrete Backend client", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const imports = sourceFiles(join(packageRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(manifest.dependencies).not.toHaveProperty("@kody-ade/backend");
    expect(imports).not.toContain("@kody-ade/backend");
  });

  it("receives repository storage per request instead of through global startup state", () => {
    const source = readFileSync(
      join(packageRoot, "src", "repo-docs.ts"),
      "utf8",
    );

    expect(source).toContain("runWithCmsRepoDocsStore");
    expect(source).toContain("AsyncLocalStorage");
    expect(source).not.toContain("globalThis");
    expect(source).not.toContain("Symbol.for");
  });

  it("owns its storage transport contract", () => {
    const cmsSource = sourceFiles(join(packageRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const baseStorageIndex = readFileSync(
      resolve(packageRoot, "../base/src/storage/index.ts"),
      "utf8",
    );

    expect(cmsSource).not.toContain("@kody-ade/base/storage");
    expect(baseStorageIndex).not.toContain("CmsStorageTransport");
    expect(baseStorageIndex).not.toContain("createCmsStorageTransport");
  });
});
