import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
// Panels that moved to @kody-ade/kody-chat-dashboard are read from the package copy.
const PACKAGE_COMPONENTS = new Set([
  "SecretsManager.tsx",
  "CommandsManager.tsx",
  "ModelsManager.tsx",
  "BrandsManager.tsx",
  "InstructionsManager.tsx",
]);
const FEATURE_ROOTS = readdirSync(join(process.cwd(), "src/dashboard/features")).map(
  (f) => join("src/dashboard/features", f, "components"),
);
const componentsRoot = (file: string) => {
  if (PACKAGE_COMPONENTS.has(file))
    return "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components";
  for (const dir of ["src/dashboard/lib/components", ...FEATURE_ROOTS]) {
    if (existsSync(join(process.cwd(), dir, file))) return dir;
  }
  return "src/dashboard/lib/components";
};
const component = (file: string) =>
  read(file.startsWith("src/") ? file : join(componentsRoot(file), file));
const sourceFile = (file: string) =>
  read(
    file.startsWith("src/") || file.startsWith("node_modules/")
      ? file
      : join(componentsRoot(file), file),
  );

const directRepoOwnedLinkHref =
  /<Link(?:\s|>)[\s\S]{0,240}href="\/(?:activity|agent-loops|capabilities|commands|config|context|docs|memory|messages|models|notifications|preview|reports|runner|secrets|tasks|variables)(?:\/|")/;

describe("repo-scoped panel route surfaces", () => {
  it("keeps file-backed guidance pages on their route-owned workspaces", () => {
    const shell = read(
      "src/dashboard/lib/components/ChatRailShell.tsx",
    );
    expect(shell).not.toContain("contextChatPlugin");
    expect(shell).not.toContain("memoryChatPlugin");
    expect(shell).not.toContain('"/context": CONTEXT_PANEL_ID');
    expect(shell).not.toContain('"/memory": MEMORY_PANEL_ID');

    for (const path of [
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/ContextControl.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/MemoryManager.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/context/index.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/context/panel.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/memory/index.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/memory/panel.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/pages/context.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/pages/context-detail.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/pages/memory.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/pages/memory-detail.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/hooks/useContextEntries.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/hooks/useMemory.ts",
      "src/dashboard/lib/hooks/useContextEntries.ts",
      "src/dashboard/lib/hooks/useMemory.ts",
    ]) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(false);
    }

    const packageApi = read(
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/integration-api.ts",
    );
    expect(packageApi).not.toContain("export const contextApi");
    expect(packageApi).not.toContain("export const memoryApi");

  });

  it("has reusable client primitives for scoped links and imperative navigation", () => {
    const hookPath = join(
      process.cwd(),
      "src/dashboard/lib/hooks/useRepoScopedHref.ts",
    );
    const linkPath = join(
      process.cwd(),
      "src/dashboard/lib/components/RepoScopedLink.tsx",
    );

    expect(existsSync(hookPath)).toBe(true);
    expect(existsSync(linkPath)).toBe(true);
    expect(
      read(
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/hooks/useRepoScopedHref.ts",
      ),
    ).toContain("repoScopedHref");
    expect(
      read(
        "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/RepoScopedLink.tsx",
      ),
    ).toContain("useRepoScopedHref");
  });

  it("does not render direct repo-owned href literals in panel components", () => {
    for (const file of [
      "DashboardHome.tsx",
      "InboxList.tsx",
      "VaultLockedBanner.tsx",
      "src/dashboard/lib/push/PushCard.tsx",
      "SecretsManager.tsx",
      "CommandsManager.tsx",
      "ModelsManager.tsx",
      "VariablesManager.tsx",
      "node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/chat/plugins/commands/SlashCommandMenu.tsx",
      "OperatorsWarningBanner.tsx",
      "RunnerManager.tsx",
      "NotificationsManager.tsx",
    ]) {
      expect(sourceFile(file), file).not.toMatch(directRepoOwnedLinkHref);
    }
  });

  it("uses scoped imperative navigation for selection reset routes", () => {
    for (const file of [
      "AgentsControl.tsx",
      // DashboardFilesPage owns host routing; the File Manager stays agnostic.
      "src/dashboard/features/file-spaces/DashboardFilesPage.tsx",
      "PreviewWorkspace.tsx",
      "MessagesView.tsx",
      "TodoControl.tsx",
    ]) {
      const source = component(file);
      expect(source, file).toContain("useRepoScopedHref");
      expect(source, file).not.toMatch(
        /router\.(?:push|replace)\("\/(?:agents|company-intents|context|docs|memory|messages|preview)?\"\)/,
      );
    }
  });

  it("keeps static docs back links scoped through the shared link primitive", () => {
    for (const path of [
      "app/(chat-rail)/commands/docs/page.tsx",
      "app/(chat-rail)/notifications/docs/page.tsx",
      "app/(chat-rail)/notifications/push-docs/page.tsx",
      "app/(chat-rail)/secrets/docs/page.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain("RepoScopedLink");
      expect(source, path).not.toMatch(directRepoOwnedLinkHref);
    }
  });
});
