import { describe, expect, it } from "vitest";

import { shouldSyncPreviewBrowserUrl } from "@dashboard/lib/preview-browser-url";

describe("preview browser URL sync", () => {
  const dashboardOrigin = "http://localhost:3333";
  const repoViewUrl =
    "http://localhost:3333/api/kody/views/_t/token123/lending-page/index.html";

  it("ignores embedded third-party frame URLs for repo-backed views", () => {
    expect(
      shouldSyncPreviewBrowserUrl(
        "https://www.youtube.com/embed/4BpyIiLs3jI?autoplay=1",
        repoViewUrl,
        dashboardOrigin,
      ),
    ).toBe(false);
  });

  it("ignores dashboard shell URLs while viewing a repo-backed view", () => {
    expect(
      shouldSyncPreviewBrowserUrl(
        "http://localhost:3333/repo/A-Guy-educ/A-Guy-Web/preview/lending-page",
        repoViewUrl,
        dashboardOrigin,
      ),
    ).toBe(false);
  });

  it("accepts navigation inside the same repo-backed view mount", () => {
    expect(
      shouldSyncPreviewBrowserUrl(
        "http://localhost:3333/api/kody/views/_t/token123/lending-page/about.html",
        repoViewUrl,
        dashboardOrigin,
      ),
    ).toBe(true);
  });

  it("accepts same-origin navigation for normal branch previews", () => {
    expect(
      shouldSyncPreviewBrowserUrl(
        "https://kp-preview.fly.dev/dashboard",
        "https://kp-preview.fly.dev/",
        dashboardOrigin,
      ),
    ).toBe(true);
  });

  it("ignores embedded third-party URLs for normal branch previews", () => {
    expect(
      shouldSyncPreviewBrowserUrl(
        "https://www.youtube.com/embed/4BpyIiLs3jI",
        "https://kp-preview.fly.dev/",
        dashboardOrigin,
      ),
    ).toBe(false);
  });
});
