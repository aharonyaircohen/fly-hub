/**
 * Source-level structural tests for repository removal entry points.
 *
 * These components depend on browser auth state and Radix overlays, while the
 * repo intentionally does not carry a DOM testing setup. This follows the
 * existing source assertion pattern for hook-heavy UI components.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const FEATURE_ROOTS = readdirSync(
  join(process.cwd(), "src/dashboard/features"),
).map((f) => join("src/dashboard/features", f, "components"));
const componentDir = (file: string) => {
  for (const dir of ["src/dashboard/lib/components", ...FEATURE_ROOTS]) {
    if (existsSync(join(process.cwd(), dir, file))) return dir;
  }
  return "src/dashboard/lib/components";
};

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readComponent(name: string): string {
  return readFileSync(
    resolve(__dirname, "../..", componentDir(`${name}.tsx`), `${name}.tsx`),
    "utf8",
  );
}

const REPO_SWITCHER = readFileSync(
  resolve(
    __dirname,
    "../../node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/RepoSwitcher.tsx",
  ),
  "utf8",
);
const MOBILE_MENU = readFileSync(
  resolve(
    __dirname,
    "../../node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/MobileMenu.tsx",
  ),
  "utf8",
);
const ORG_MANAGER = readComponent("OrgManager");

describe("repository removal surfaces", () => {
  it("keeps the header repository remove button visible on touch screens", () => {
    const removeButtonClass = REPO_SWITCHER.match(
      /aria-label=\{`Remove \$\{entry\.owner\}\/\$\{entry\.repo\}`\}[\s\S]*?className="([^"]+)"/,
    )?.[1];

    expect(removeButtonClass).toContain(
      "md:opacity-0 md:group-hover:opacity-100",
    );
    expect(removeButtonClass).not.toContain(
      "opacity-0 group-hover:opacity-100",
    );
    expect(REPO_SWITCHER).not.toContain("disabled={entry.isLogin}");
    expect(REPO_SWITCHER).not.toContain("Login repo can't be removed");
  });

  it("reuses the repository switcher for mobile repository removal", () => {
    expect(MOBILE_MENU).toContain(
      'import { RepoSwitcher } from "./RepoSwitcher"',
    );
    expect(MOBILE_MENU).toContain(
      'headerExtra = <RepoSwitcher variant="rail" />',
    );
    expect(REPO_SWITCHER).toMatch(/setConfirmRemove\(\{ index, entry \}\)/);
    expect(REPO_SWITCHER).toMatch(/removeRepo\(index\)/);
  });

  it("exposes repository removal on the org page attached repository rows", () => {
    expect(ORG_MANAGER).toMatch(/setConfirmRemove\(\{ index, entry: repo \}\)/);
    expect(ORG_MANAGER).not.toMatch(/Login repo can't be removed/);
    expect(ORG_MANAGER).not.toContain("index < 0 || repo.isLogin");
    expect(ORG_MANAGER).toMatch(/removeRepo\(confirmRemove\.index\)/);
  });
});
