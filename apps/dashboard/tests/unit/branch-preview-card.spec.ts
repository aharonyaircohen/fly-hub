/**
 * Source-level structural tests for BranchPreviewCard.
 *
 * The repo runs Vitest in node mode and does not include happy-dom /
 * @testing-library/react, so this follows the component structural-test
 * pattern used elsewhere in the dashboard.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRANCH_PREVIEW_CARD_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/BranchPreviewCard.tsx",
);
const SOURCE = readFileSync(BRANCH_PREVIEW_CARD_PATH, "utf8");

describe("BranchPreviewCard", () => {
  it("keeps polling while a branch preview is not terminal", () => {
    expect(SOURCE).toMatch(/BRANCH_PREVIEW_REFRESH_MS/);
    expect(SOURCE).toMatch(/REFRESHING_PREVIEW_STATES/);
    expect(SOURCE).toMatch(/previews\.some\(\(preview\) =>/);
    expect(SOURCE).toMatch(/window\.setTimeout/);
    expect(SOURCE).toMatch(/refresh\(\{ showLoading: false \}\)/);
    expect(SOURCE).toMatch(/window\.clearTimeout/);
  });

  it("does not treat running or failed previews as refresh-needed states", () => {
    const statesMatch = SOURCE.match(
      /const REFRESHING_PREVIEW_STATES[\s\S]*?as const;/,
    );
    expect(statesMatch).not.toBeNull();
    expect(statesMatch![0]).toContain('"pending"');
    expect(statesMatch![0]).toContain('"building"');
    expect(statesMatch![0]).toContain('"starting"');
    expect(statesMatch![0]).toContain('"unknown"');
    expect(statesMatch![0]).not.toContain('"running"');
    expect(statesMatch![0]).not.toContain('"failed"');
  });
});
