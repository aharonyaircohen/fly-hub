import { describe, expect, it } from "vitest";

import {
  htmlPreviewDocument,
  isHtmlFile,
} from "@dashboard/features/file-manager/lib/html-preview";

describe("htmlPreviewDocument", () => {
  it("allows a browser-like document inside an isolated frame", () => {
    const document = htmlPreviewDocument(
      "<!doctype html><html><body><h1>Preview</h1></body></html>",
    );

    expect(document).toContain(
      '<meta http-equiv="Content-Security-Policy" content="',
    );
    expect(document).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:",
    );
    expect(document).toContain("style-src 'unsafe-inline' https: data: blob:");
    expect(document).toContain("img-src https: data: blob:");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("<h1>Preview</h1>");
    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(
      document.indexOf("<html>"),
    );
  });

  it("recognizes both HTML extensions case-insensitively", () => {
    expect(isHtmlFile("index.html")).toBe(true);
    expect(isHtmlFile("legacy.HTM")).toBe(true);
    expect(isHtmlFile("template.html.txt")).toBe(false);
  });
});
