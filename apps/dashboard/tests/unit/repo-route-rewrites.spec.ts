import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

describe("repo route rewrites", () => {
  it("keeps the real repo home route out of the legacy page rewrite", () => {
    expect(source).toContain("async rewrites()");
    expect(source).not.toContain('source: "/repo/:owner/:repo"');
    expect(source).toContain('source: "/repo/:owner/:repo/:path+"');
    expect(source).toContain('destination: "/:path+"');
    const beforeFiles = source.slice(
      source.indexOf("beforeFiles:"),
      source.indexOf("fallback:"),
    );
    expect(beforeFiles).toContain('source: "/repo/:owner/:repo/:path+"');
  });

  it("routes the Memory workspace through its dedicated adapter", () => {
    expect(source).toContain('source: "/repo/:owner/:repo/memory"');
    expect(source).toContain('destination: "/memory-files"');
    expect(source).toContain('source: "/repo/:owner/:repo/memory/:path+"');
    expect(source).toContain('destination: "/memory-files/:path+"');
  });
});
