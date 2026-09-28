import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manager = readFileSync(resolve(root, "src/dashboard/features/admin/components/RunnerManager.tsx"), "utf8");
const shell = readFileSync(resolve(root, "app/FlyShell.tsx"), "utf8");

describe("Fly Hub connection", () => {
  it("uses the Fly token session instead of repository secrets", () => {
    expect(shell).toContain('/api/fly-hub/session');
    expect(shell).toContain('Fly API token');
    expect(manager).not.toContain('/secrets');
    expect(manager).not.toContain('useFlyTokenStatus');
    expect(manager).toContain('<FlyMachinesTable');
  });

  it("has only the user-facing machine pages in navigation", () => {
    expect(shell).toContain('href: "/fly/machines"');
    expect(shell).toContain('href: "/fly/history"');
    expect(shell).not.toContain('href: "/fly/config"');
    expect(shell).not.toContain('href: "/fly/previews"');
  });
});
