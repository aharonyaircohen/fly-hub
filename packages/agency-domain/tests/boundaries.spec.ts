import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentDefinition, deletionIssues } from "../src/index";

describe("domain responsibility boundaries", () => {
  it("has no runtime dependencies or removed public models", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    );
    const source = readFileSync(
      resolve(import.meta.dirname, "../src/index.ts"),
      "utf8",
    );
    expect(pkg.dependencies).toBeUndefined();
    expect(source).not.toMatch(
      /IntentDefinition|OperationDefinition|ImplementationDefinition/,
    );
    expect(source).not.toMatch(
      /from ["'](?:convex|next|@octokit|@kody-ade\/backend)/,
    );
  });

  it("keeps Agent identity independent of orchestration", () => {
    expect(
      createAgentDefinition({
        id: "developer",
        name: "Developer",
        instructions: "Implement approved changes.",
        permissions: ["code.write"],
      }),
    ).toMatchObject({ id: "developer" });
    expect(() =>
      createAgentDefinition({
        id: "developer",
        name: "Developer",
        instructions: "Implement approved changes.",
        permissions: ["code.write"],
        workflow: "release",
      }),
    ).toThrow(/workflow/);
  });

  it("protects referenced definitions from deletion", () => {
    expect(
      deletionIssues({ kind: "workflow", id: "release" }, [
        {
          owner: { kind: "loop", id: "daily-release" },
          field: "target",
          target: { kind: "workflow", id: "release" },
        },
      ]),
    ).toEqual(['Referenced by Loop "daily-release" through target']);
  });
});
