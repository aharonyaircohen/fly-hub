import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const consumerRoots = [
  join(repositoryRoot, "apps"),
  join(repositoryRoot, "packages", "kody-chat-dashboard"),
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", ".next", "tests"].includes(entry.name)
        ? []
        : sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("@kody-ade/agency package boundary", () => {
  it("keeps private persistence modules hidden from consumers", () => {
    const boundaryLeaks = consumerRoots.flatMap((root) =>
      sourceFiles(root).filter((path) =>
        readFileSync(path, "utf8").includes("@kody-ade/agency/backend/"),
      ),
    );

    expect(boundaryLeaks).toEqual([]);
  });
});
