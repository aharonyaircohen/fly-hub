import { describe, expect, it } from "vitest";
import {
  FILE_HTML_PREVIEW_CSP,
  FILE_HTML_PREVIEW_SANDBOX,
  REPO_VIEW_CSP,
  REPO_VIEW_SANDBOX,
} from "@dashboard/lib/html-preview-security";

describe("HTML preview security profiles", () => {
  it("keeps repository file previews isolated from dashboard capabilities", () => {
    expect(FILE_HTML_PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(FILE_HTML_PREVIEW_CSP).toContain("form-action 'none'");
    expect(FILE_HTML_PREVIEW_CSP).toContain("frame-src 'none'");
  });

  it("keeps the hosted-view iframe and response policy synchronized", () => {
    expect(REPO_VIEW_SANDBOX).toBe(
      "allow-scripts allow-forms allow-popups allow-downloads",
    );
    expect(REPO_VIEW_CSP).toContain(`sandbox ${REPO_VIEW_SANDBOX}`);
  });

  it("does not silently grant hosted-view permissions to file previews", () => {
    expect(FILE_HTML_PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    expect(FILE_HTML_PREVIEW_SANDBOX).not.toContain("allow-top-navigation");
    for (const permission of ["allow-forms", "allow-popups", "allow-downloads"]) {
      expect(FILE_HTML_PREVIEW_SANDBOX).not.toContain(permission);
      expect(REPO_VIEW_SANDBOX).toContain(permission);
    }
  });
});
