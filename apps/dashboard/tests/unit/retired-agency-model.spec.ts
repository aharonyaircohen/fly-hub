import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const removedName = "goal";

describe("retired agency model", () => {
  it("has no routes, feature directory, or runtime modules", () => {
    const removedPaths = [
      `apps/dashboard/app/api/kody/${removedName}s`,
      `apps/dashboard/src/dashboard/features/${removedName}s`,
      `apps/dashboard/src/dashboard/lib/${removedName}s.ts`,
      `apps/dashboard/src/dashboard/lib/${removedName}s-server.ts`,
      `apps/dashboard/src/dashboard/lib/${removedName}-state.ts`,
      `packages/agency/src/${removedName}s.ts`,
      `packages/agency/src/${removedName}s-server.ts`,
      `packages/agency/src/${removedName}-state.ts`,
      `packages/agency/src/backend/${removedName}s-state.ts`,
      `packages/agency/src/routes/${removedName}s.ts`,
      `packages/agency/src/routes/${removedName}s-id.ts`,
      `packages/agency/src/routes/${removedName}s-id-discussion.ts`,
      `packages/agency/src/routes/${removedName}s-reorder.ts`,
      `packages/kody-backend/convex/${removedName}s.ts`,
      `packages/kody-chat-dashboard/src/dashboard/lib/${removedName}s.ts`,
      `packages/kody-chat-dashboard/src/dashboard/lib/${removedName}s-server.ts`,
      `packages/kody-chat-dashboard/src/dashboard/lib/${removedName}-state.ts`,
      `packages/kody-chat-dashboard/src/dashboard/lib/chat/plugins/${removedName}s`,
    ];

    expect(
      removedPaths.filter((path) => existsSync(resolve(repoRoot, path))),
    ).toEqual([]);
  });

  it("has no retired activation or persistence contracts", () => {
    const files = [
      "packages/base/src/engine/config.ts",
      "packages/kody-backend/convex/schema.ts",
      "packages/kody-backend/src/table-registry.ts",
      "packages/kody-chat-dashboard/src/dashboard/lib/integration-api.ts",
    ];
    const forbidden = [
      `active${removedName[0]!.toUpperCase()}${removedName.slice(1)}s`,
      `${removedName}Id`,
      `managed${removedName[0]!.toUpperCase()}${removedName.slice(1)}`,
    ];

    for (const file of files) {
      const source = readFileSync(resolve(repoRoot, file), "utf8");
      for (const token of forbidden) expect(source).not.toContain(token);
    }
  });
});
