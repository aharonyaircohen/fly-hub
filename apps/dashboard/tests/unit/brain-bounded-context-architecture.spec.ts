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
      "../../packages/brain/src/overview.ts",
      "../../packages/brain/src/server-commands.ts",
      "../../packages/brain/src/image-save-command.ts",
      "../../packages/brain/src/image-management.ts",
      "../../packages/brain/src/image-apply-command.ts",
      "../../packages/brain/src/terminal-connect.ts",
      "../../packages/fly/src/terminal/session-connect.ts",
    ]) {
      expect(exists(path), path).toBe(true);
      expect(source(path), path).toContain("@fileType use-case");
    }
  });

  it("keeps Brain API routes as use-case wrappers", () => {
    expect(source("../../packages/brain/src/routes/status.ts")).toContain(
      "readBrainOverview(",
    );
    expect(source("../../packages/brain/src/routes/provision.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/login.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("app/api/kody/chat/brain-fly/route.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/resume.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/suspend.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/destroy.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/suspension.ts")).toContain(
      "manageBrainServer(",
    );
    expect(source("../../packages/brain/src/routes/image-apply.ts")).toContain(
      "enqueueRestore",
    );
    expect(source("../../packages/fly/src/routes/terminal-session.ts")).toContain(
      "startTerminalSession(",
    );
  });
});
