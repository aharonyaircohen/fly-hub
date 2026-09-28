import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/dashboard/lib/components/ChatRailShell.tsx"),
  "utf8",
);

describe("legacy repo route redirect shell", () => {
  it("redirects repo-owned legacy paths through the shared route contract", () => {
    expect(source).toContain("legacyRepoRedirectPath");
    expect(source).toContain("router.replace");
    expect(source).toContain("window.location.search");
    expect(source).toContain("window.location.hash");
  });
});
