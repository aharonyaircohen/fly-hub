import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync(
  join(
    process.cwd(),
    "src/dashboard/features/previews/components/PreviewWorkspace.tsx",
  ),
  "utf8",
);

describe("localhost preview boundary", () => {
  it("allows an external saved preview to load on localhost", () => {
    expect(workspaceSource).not.toContain("isExternalPreviewOnLocalhost");
    expect(workspaceSource).not.toContain(
      "External preview blocked on localhost",
    );
    expect(workspaceSource).toMatch(
      /<PreviewPane\s+[\s\S]*?baseUrl=\{baseUrl\}/,
    );
  });
});
