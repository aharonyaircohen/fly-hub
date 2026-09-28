import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("personal surface boundaries", () => {
  it("does not expose repository memory folders without an active repository", () => {
    const memory = source(
      "src/dashboard/features/memory/components/MemoryFilesPage.tsx",
    );

    expect(memory).toContain(
      'repositoryScoped ? ["repository"] : ["personal"]',
    );
    expect(memory).toContain(
      'fixedScope={repositoryScoped ? "repository" : "user"}',
    );
  });

  it("shows repository preview controls only for repository secrets", () => {
    const secrets = source(
      "../../packages/kody-chat-dashboard/src/dashboard/lib/components/SecretsManager.tsx",
    );

    expect(secrets).toContain(
      "{repositoryScoped ? <VercelBypassCard /> : null}",
    );
  });

  it("owns personal conversations with the signed-in Kody user", () => {
    const chatRail = source("src/dashboard/lib/components/ChatRailShell.tsx");

    expect(chatRail).toContain(
      "repositoryActive ? githubUser?.login : kodySession?.user.id",
    );
    expect(chatRail).not.toContain(
      "repositoryActive ? githubUser?.login : undefined",
    );
  });

  it("uses provider-neutral workspace wording", () => {
    const shell = source(
      "src/dashboard/features/file-manager/components/FileWorkspaceShell.tsx",
    );

    expect(shell).toContain("Workspace");
    expect(shell).not.toContain("Repository workspace");

    const filesPage = source(
      "src/dashboard/features/file-manager/components/FilesPage.tsx",
    );
    const fileTree = source(
      "src/dashboard/features/file-manager/components/FileTree.tsx",
    );
    expect(filesPage).not.toContain('workspaceRoot || "Repository"');
    expect(fileTree).not.toContain('return "Repository"');
  });
});
