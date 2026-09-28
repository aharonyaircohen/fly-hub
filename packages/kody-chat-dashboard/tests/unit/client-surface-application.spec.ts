import { describe, expect, it } from "vitest";

import { parseClientSurfaceRoute } from "../../src/dashboard/lib/client-surface/application";

describe("parseClientSurfaceRoute", () => {
  it("accepts a built-in brand without repository context", () => {
    expect(parseClientSurfaceRoute(["kody"])).toEqual({
      brandSlug: "kody",
      urlContext: null,
      callbackUrl: "/client/kody",
    });
  });

  it("accepts an explicitly repository-scoped brand", () => {
    expect(
      parseClientSurfaceRoute(["A-Guy-educ", "A-Guy-Teacher", "acme"]),
    ).toEqual({
      brandSlug: "acme",
      urlContext: {
        owner: "A-Guy-educ",
        repo: "A-Guy-Teacher",
      },
      callbackUrl: "/client/A-Guy-educ/A-Guy-Teacher/acme",
    });
  });

  it.each([
    undefined,
    [],
    ["custom-brand"],
    ["owner", "repo"],
    ["owner", "repo", "brand", "extra"],
    ["bad owner", "repo", "brand"],
    ["owner", "repo", "%E0%A4%A"],
  ])("rejects malformed or ambiguous paths: %j", (path) => {
    expect(parseClientSurfaceRoute(path)).toBeNull();
  });
});
