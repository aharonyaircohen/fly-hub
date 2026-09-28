import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/Composer.tsx"),
  "utf8",
);

describe("composer primary action", () => {
  it("keeps the primary action icon-only while the composer is empty", () => {
    expect(SOURCE).not.toContain("if (!showTrailingButton) return null;");
    expect(SOURCE).toContain("inline-flex h-10");
    expect(SOURCE).toContain('aria-label={title}');
    expect(SOURCE).not.toContain("<span>{label}</span>");
  });

  it("keeps Kody Live start/stop available while input is locked", () => {
    expect(SOURCE).toContain("composerActionDisabled = composerDisabled");
    expect(SOURCE).toContain("Boolean(terminalSendDisabled) ||");
    expect(SOURCE).toContain("composerActionDisabled ||");
  });
});
