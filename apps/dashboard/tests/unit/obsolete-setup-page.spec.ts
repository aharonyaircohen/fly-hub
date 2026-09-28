import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

describe("obsolete Setup page", () => {
  it("does not expose the empty Setup page or its unused wizard system", () => {
    const removedPaths = [
      "apps/dashboard/app/(chat-rail)/setup/page.tsx",
      "apps/dashboard/src/dashboard/features/admin/components/SetupManager.tsx",
      "apps/dashboard/src/dashboard/lib/components/WizardRunner.tsx",
      "apps/dashboard/src/dashboard/lib/wizards/registry.ts",
      "apps/dashboard/src/dashboard/lib/wizards/types.ts",
    ];

    expect(
      removedPaths.filter((path) => existsSync(resolve(repositoryRoot, path))),
    ).toEqual([]);

    const navigationSources = [
      "apps/dashboard/src/dashboard/lib/components/settings-nav.ts",
      "packages/kody-chat-dashboard/src/dashboard/lib/feature-catalog.ts",
      "apps/dashboard/tests/e2e/pages-render-smoke.spec.ts",
    ].map((path) => readFileSync(resolve(repositoryRoot, path), "utf8"));

    expect(navigationSources.join("\n")).not.toContain('"/setup"');
  });
});
