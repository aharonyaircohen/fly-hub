import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const scannedRoots = [
  "apps/dashboard/app",
  "apps/dashboard/src",
  "apps/dashboard/tests/e2e",
  "apps/dashboard/kody.config.json",
  "kody.config.json",
  "packages/base/src",
  "packages/brain/src",
  "packages/kody-backend/convex",
  "packages/kody-chat-dashboard/app",
  "packages/kody-chat-dashboard/src",
];
const sourceExtensions = new Set([".json", ".ts", ".tsx"]);
const obsoleteRepositoryReferences = [
  /github\.com\/aharonyaircohen\/Kody-Dashboard/i,
  /repo\s*:\s*["']Kody-Dashboard["']/,
  /GITHUB_REPO\s*\?\?\s*["']Kody-Dashboard["']/,
];

function sourceFiles(path: string): string[] {
  const absolutePath = resolve(repositoryRoot, path);
  if (!statSync(absolutePath).isDirectory()) return [absolutePath];

  return readdirSync(absolutePath).flatMap((entry) =>
    sourceFiles(resolve(absolutePath, entry)),
  );
}

describe("obsolete Dashboard repository boundary", () => {
  it("keeps live Dashboard code independent from the obsolete repository", () => {
    const offenders = scannedRoots
      .flatMap(sourceFiles)
      .filter((path) => sourceExtensions.has(extname(path)))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return obsoleteRepositoryReferences.some((pattern) =>
          pattern.test(source),
        );
      })
      .map((path) => path.replace(`${repositoryRoot}/`, ""));

    expect(offenders).toEqual([]);
  });
});
