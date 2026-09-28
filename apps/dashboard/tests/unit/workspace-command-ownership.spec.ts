import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

function readPackage(relativePath: string) {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, relativePath), "utf8"),
  ) as {
    description?: string;
    scripts?: Record<string, string>;
  };
}

describe("workspace command ownership", () => {
  it("starts the real Dashboard from the root dev command", () => {
    const rootPackage = readPackage("package.json");

    expect(rootPackage.scripts?.dev).toBe(
      "pnpm --parallel --filter @kody-ade/backend --filter kody-dashboard dev",
    );
    expect(rootPackage.scripts?.["dev:dashboard"]).toBe(
      "pnpm --parallel --filter @kody-ade/backend --filter kody-dashboard dev",
    );
  });

  it("does not expose the private integration as a second application", () => {
    const rootPackage = readPackage("package.json");
    const integrationPackage = readPackage(
      "packages/kody-chat-dashboard/package.json",
    );

    expect(rootPackage.scripts).not.toHaveProperty("dev:chat-integration");
    expect(integrationPackage.description).toBe(
      "Private Kody-specific chat integration consumed by the Dashboard host",
    );
  });
});
