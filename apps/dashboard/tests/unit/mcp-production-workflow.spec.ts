import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

describe("MCP production workflow", () => {
  it("disables Vercel Git auto-deployments", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    );

    expect(config.git?.deploymentEnabled).toBe(false);
  });

  it("uses a Kody workflow instead of a parallel deployment workflow", () => {
    expect(
      existsSync(resolve(repoRoot, ".github/workflows/deploy-dashboard.yml")),
    ).toBe(false);

    expect(
      existsSync(
        resolve(
          repoRoot,
          ".kody-engine/definitions/workflows/dashboard-production-release/workflow.json",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(
          repoRoot,
          ".kody-engine/definitions/capabilities/dashboard-production-release/contract.json",
        ),
      ),
    ).toBe(false);
  });

  it("keeps the generic MCP workflow action as the public deployment entrypoint", () => {
    const catalog = readFileSync(
      resolve(
        repoRoot,
        "packages/kody-chat-dashboard/src/dashboard/lib/mcp/catalog.ts",
      ),
      "utf8",
    );

    expect(catalog).toContain('id: "workflow.run.request"');
    expect(catalog).not.toContain('id: "deployment.run.request"');
  });

});
