import { describe, expect, it } from "vitest";

function isTestAuthEnabled(value: string | undefined): boolean {
  return value === "true";
}

describe("test login visibility", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isTestAuthEnabled(undefined)).toBe(false);
    expect(isTestAuthEnabled("false")).toBe(false);
  });

  it("is enabled only for the explicit QA flag", () => {
    expect(isTestAuthEnabled("true")).toBe(true);
  });
});
