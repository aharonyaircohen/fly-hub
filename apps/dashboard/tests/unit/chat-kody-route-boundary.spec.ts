import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = resolve(
  process.cwd(),
  "app/api/kody/chat/kody/route.ts",
);

describe("dashboard Kody chat route boundary", () => {
  it("delegates the endpoint to the package-owned route", () => {
    const source = readFileSync(routePath, "utf8");

    expect(source).toContain(
      'from "@kody-ade/kody-chat-dashboard/routes/kody/chat-kody"',
    );
    expect(source).toContain("export async function POST");
    expect(source).toContain("requireKodyUser");
    expect(source).toContain("resolveSurfaceScope(request.headers)");
    expect(source).toContain('kind !== "client"');
    expect(source).toContain("return packagePost(request)");
    expect(source).not.toContain("new NextRequest");
    expect(source.split("\n").length).toBeLessThan(30);
  });
});
