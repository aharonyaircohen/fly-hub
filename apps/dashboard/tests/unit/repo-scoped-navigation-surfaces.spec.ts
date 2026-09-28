import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(
    join(process.cwd(), "src/dashboard/lib/components", file),
    "utf8",
  );

describe("repo-scoped navigation surfaces", () => {
  it("scopes desktop sidebar links through the route model", () => {
    // Sidebar ships from @kody-ade/kody-chat-dashboard — dash consumes, never forks.
    const sidebar = readFileSync(
      join(
        process.cwd(),
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/Sidebar.tsx",
      ),
      "utf8",
    );
    expect(sidebar).toContain("repoScopedHref");
    expect(sidebar).toContain("scopedHref(item.href, item.scope)");
    expect(sidebar).toContain("renderLink(pinnedItem");
  });

  it("scopes mobile menu links through the shared sidebar", () => {
    const mobileMenu = readFileSync(
      join(
        process.cwd(),
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/MobileMenu.tsx",
      ),
      "utf8",
    );
    expect(mobileMenu).toContain('import { Sidebar } from "./Sidebar"');
    expect(mobileMenu).toMatch(/<Sidebar\s+presentation="mobile"/);
  });

  it("scopes command palette navigation through the route model", () => {
    const commandPalette = source("CommandPalette.tsx");
    expect(commandPalette).toContain("repoScopedHref");
    expect(commandPalette).toContain("repoPathForNavMatching");
    expect(commandPalette).toContain("router.push(scopedHref(href))");
  });

  it("scopes chat rail expansion under repo routes", () => {
    const chatRailShell = source("ChatRailShell.tsx");
    expect(chatRailShell).toContain("repoPathForNavMatching");
    expect(chatRailShell).toContain('currentRepoPath === "/chat"');
    expect(chatRailShell).toContain('currentRepoPath.startsWith("/chat/")');
    expect(chatRailShell).toContain("routeOwnsAppHeader(currentRepoPath)");
    expect(chatRailShell).not.toContain('pathname === "/chat"');
    expect(chatRailShell).not.toContain("routeOwnsAppHeader(pathname)");
    expect(chatRailShell).toContain('router.push(scopedHref("/chat"))');
    expect(chatRailShell).toContain('scopedHref("/tasks")');
  });
});
