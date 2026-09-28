import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "../../packages/kody-chat-dashboard/src/dashboard/lib/components/VercelBypassCard.tsx",
  ),
  "utf8",
);

describe("browser-scoped secret display", () => {
  it("keeps saved bypass credentials write-only in the DOM", () => {
    expect(source).not.toContain("setVercelSecret(auth?.vercelBypassSecret");
    expect(source).toContain("A bypass secret is saved");
    expect(source).toContain("const hasChanges = vercelSecret.trim().length > 0");
  });
});
