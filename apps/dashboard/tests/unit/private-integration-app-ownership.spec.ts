import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const dashboardApp = join(repositoryRoot, "apps/dashboard/app");
const integrationApp = join(repositoryRoot, "packages/kody-chat-dashboard/app");
const dashboardTests = join(repositoryRoot, "apps/dashboard/tests");
const integrationTests = join(
  repositoryRoot,
  "packages/kody-chat-dashboard/tests",
);
const dashboardSource = join(repositoryRoot, "apps/dashboard/src/dashboard");
const integrationSource = join(
  repositoryRoot,
  "packages/kody-chat-dashboard/src/dashboard",
);
const ownershipManifest = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "apps/dashboard/private-integration-ownership.json"),
    "utf8",
  ),
) as {
  entries: Array<{
    path: string;
    owner: "agency" | "app" | "base" | "integration" | "split";
  }>;
};

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function exists(root: string, path: string): boolean {
  try {
    readFileSync(join(root, path), "utf8");
    return true;
  } catch {
    return false;
  }
}

function isForwardingModule(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();

  if (!withoutComments) return false;

  const statements = withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  return statements.every(
    (statement) =>
      (statement.startsWith("import ") &&
        (statement.includes(" from ") || /^import\s+["']/.test(statement))) ||
      (statement.startsWith("export ") &&
        (statement.includes(" from ") || statement.startsWith("export *"))),
  );
}

describe("private integration app ownership", () => {
  it("does not keep byte-identical app implementations in both workspaces", () => {
    const duplicated = files(integrationApp)
      .map((path) => relative(integrationApp, path))
      .filter((path) => {
        try {
          return (
            readFileSync(join(dashboardApp, path), "utf8") ===
            readFileSync(join(integrationApp, path), "utf8")
          );
        } catch {
          return false;
        }
      });

    expect(duplicated).toEqual([]);
  });

  it("does not run byte-identical tests in both workspaces", () => {
    const duplicated = files(integrationTests)
      .map((path) => relative(integrationTests, path))
      .filter((path) => /\.(?:int\.)?spec\.ts$/.test(path))
      .filter((path) => {
        try {
          return (
            readFileSync(join(dashboardTests, path), "utf8") ===
            readFileSync(join(integrationTests, path), "utf8")
          );
        } catch {
          return false;
        }
      });

    expect(duplicated).toEqual([]);
  });

  it("does not keep byte-identical source implementations in both workspaces", () => {
    const duplicated = files(integrationSource)
      .map((path) => relative(integrationSource, path))
      // This hook intentionally resolves each workspace's different local
      // inbox type contract, so identical source text is not shared ownership.
      .filter(
        (path) =>
          path !== "lib/inbox/useInbox.ts" &&
          path !== "lib/chat-defaults/index.ts",
      )
      .filter((path) => {
        try {
          const dashboardImplementation = readFileSync(
            join(dashboardSource, path),
            "utf8",
          );
          const integrationImplementation = readFileSync(
            join(integrationSource, path),
            "utf8",
          );
          return (
            dashboardImplementation === integrationImplementation &&
            !isForwardingModule(dashboardImplementation)
          );
        } catch {
          return false;
        }
      });

    expect(duplicated).toEqual([]);
  });

  it("enforces one executable owner for every classified overlap", () => {
    const violations = ownershipManifest.entries.flatMap((entry) => {
      const appExists = exists(dashboardSource, entry.path);
      const integrationExists = exists(integrationSource, entry.path);
      const appSource = appExists
        ? readFileSync(join(dashboardSource, entry.path), "utf8")
        : "";

      if (entry.owner === "integration") {
        if (!integrationExists) {
          return [`${entry.path}: missing integration implementation`];
        }
        if (appExists && !isForwardingModule(appSource)) {
          return [`${entry.path}: app contains executable package-owned code`];
        }
        return [];
      }

      if (entry.owner === "app") {
        return integrationExists
          ? [`${entry.path}: integration package contains app-owned code`]
          : [];
      }

      if (entry.owner === "agency" || entry.owner === "base") {
        const integrationModuleSource = integrationExists
          ? readFileSync(join(integrationSource, entry.path), "utf8")
          : "";
        if (appExists && !isForwardingModule(appSource)) {
          return [`${entry.path}: app contains executable ${entry.owner}-owned code`];
        }
        if (integrationExists && !isForwardingModule(integrationModuleSource)) {
          return [
            `${entry.path}: integration contains executable ${entry.owner}-owned code`,
          ];
        }
        return [];
      }

      if (!appExists || !integrationExists) {
        return [`${entry.path}: split contract is missing one side`];
      }
      const appLines = appSource.split("\n").length;
      return appSource.includes("@kody-ade/kody-chat-dashboard") &&
        appLines <= 80
        ? []
        : [`${entry.path}: split app side is not a thin host adapter`];
    });

    expect(violations).toEqual([]);
  });
});
