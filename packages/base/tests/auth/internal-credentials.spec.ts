import { describe, expect, it } from "vitest";
import { isInternalKodyCredential } from "../../src/auth/internal-credentials";

describe("internal Kody credentials", () => {
  it("hides current internal credentials and the retired managed GitHub token", () => {
    expect(isInternalKodyCredential("KODY_INTERNAL_SERVICE_TOKEN")).toBe(true);
    expect(isInternalKodyCredential("KODY_GITHUB_TOKEN")).toBe(true);
    expect(isInternalKodyCredential("OPENROUTER_API_KEY")).toBe(false);
  });
});
