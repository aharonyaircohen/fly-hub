import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy report routes", () => {
  it.each([
    ["findings", "/reports?type=finding"],
    ["learning", "/reports?type=learning"],
  ])("redirects /%s to the matching Reports filter", (route, destination) => {
    const source = readFileSync(
      join(process.cwd(), "app", "(chat-rail)", route, "page.tsx"),
      "utf8",
    );
    expect(source).toContain(`redirect("${destination}")`);
    expect(source).not.toContain("AgencyStatePage");
  });
});
