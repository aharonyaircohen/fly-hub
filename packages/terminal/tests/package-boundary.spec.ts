import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("Terminal package boundary", () => {
  it("owns its optional native PTY runtime", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { optionalDependencies?: Record<string, string> };

    expect(manifest.optionalDependencies).toHaveProperty("node-pty");
  });

  it("does not depend on the Fly implementation", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const imports = sourceFiles(join(packageRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(manifest.dependencies).not.toHaveProperty("@kody-ade/fly");
    expect(imports).not.toContain("@kody-ade/fly");
  });

  it("keeps the session domain independent of UI and runtime providers", () => {
    const domainSource = [
      "terminal-session-model.ts",
      "terminal-session-state.ts",
    ]
      .map((file) => readFileSync(join(packageRoot, "src", file), "utf8"))
      .join("\n");

    expect(domainSource).not.toMatch(/from ["'](?:react|next|@kody-ade\/fly)/);
    expect(domainSource).not.toContain("WebSocket");
    expect(domainSource).not.toContain("tmux");
    expect(domainSource).not.toContain("xterm");
  });
});
