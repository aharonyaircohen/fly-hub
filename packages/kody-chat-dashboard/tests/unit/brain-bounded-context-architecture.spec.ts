/**
 * @fileoverview Source guards for the Brain bounded context command/query shape.
 * @testFramework vitest
 * @domain brain
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(resolve(root, path));
}

describe("Brain bounded context architecture", () => {
  it("exposes command/query use cases for the Brain product", () => {
    for (const path of [
      "../brain/src/overview.ts",
      "../brain/src/server-commands.ts",
      "../brain/src/image-save-command.ts",
      "../brain/src/image-management.ts",
      "../brain/src/image-apply-command.ts",
      "../brain/src/terminal-connect.ts",
      "../fly/src/terminal/session-connect.ts",
    ]) {
      expect(exists(path), path).toBe(true);
      expect(source(path), path).toContain("@fileType use-case");
    }
  });

  it("keeps Brain API routes as use-case wrappers", () => {
    expect(source("../brain/src/routes/status.ts")).toContain(
      "readBrainOverview(",
    );
    expect(source("../brain/src/routes/provision.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/login.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/chat/brain-fly/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/resume.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/suspend.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/destroy.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/suspension.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../brain/src/routes/image-apply.ts")).toContain(
      "enqueueRestore",
    );
    // Fly-backed terminal routes live in the Fly package, not Kody Chat.
  });
});
