/**
 * @fileoverview Fly Config reports only the repo-owned Fly credential status.
 * @testFramework vitest
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const managerSource = readFileSync(
  resolve(root, "src/dashboard/features/admin/components/RunnerManager.tsx"),
  "utf8",
);
const brainImagesSource = readFileSync(
  resolve(root, "src/dashboard/features/admin/components/BrainImagesManager.tsx"),
  "utf8",
);
const hookSource = readFileSync(
  resolve(root, "src/dashboard/lib/hooks/useFlyTokenStatus.ts"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(root, "app/api/kody/fly/config-status/route.ts"),
  "utf8",
);

describe("Fly token status", () => {
  it("uses the repo credential status endpoint without reading the token value", () => {
    expect(hookSource).toContain("/api/kody/fly/config-status");
    expect(managerSource).not.toContain(
      "/api/kody/secrets/${FLY_VAULT_KEY}/value",
    );
    expect(managerSource).toContain('source === "repo-vault"');
    expect(managerSource).toContain("Repo token");
    expect(managerSource).not.toContain("Local/server fallback");
  });

  it("lets the personal Brain API own image access independently of repo credentials", () => {
    expect(managerSource).toContain("useFlyTokenStatus");
    expect(brainImagesSource).not.toContain("useFlyTokenStatus");
    expect(brainImagesSource).toContain("/api/kody/brain/image");
    expect(brainImagesSource).not.toContain("flyTokenStatus.configured");
  });

  it("keeps the dashboard route as a thin Fly package boundary", () => {
    expect(routeSource).toContain("@kody-ade/fly/routes/fly-config-status");
  });
});
