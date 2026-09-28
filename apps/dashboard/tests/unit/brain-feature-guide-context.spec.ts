import { describe, expect, it } from "vitest";

import { withDashboardFeatureGuideContext } from "@dashboard/lib/feature-guides/brain-context";

describe("Brain Dashboard feature guide context", () => {
  it("uses an explicit feature question instead of the current page", async () => {
    const result = await withDashboardFeatureGuideContext({
      currentPage: "the Tasks page (/tasks)",
      message: "Can a Workflow run on a nightly schedule?",
    });

    expect(result).toContain("Dashboard feature guide — Workflows");
    expect(result).not.toContain("Dashboard feature guide — Tasks");
    expect(result).toContain("## Current user request");
  });

  it("falls back to the current page for a generic question", async () => {
    const result = await withDashboardFeatureGuideContext({
      currentPage: "the File Spaces page (/file-spaces)",
      message: "What can I do here?",
    });

    expect(result).toContain("Dashboard feature guide — Files and File Spaces");
  });

  it("leaves the message unchanged when no feature matches", async () => {
    await expect(
      withDashboardFeatureGuideContext({
        currentPage: "the login page (/login)",
        message: "Hello",
      }),
    ).resolves.toBe("Hello");
  });
});
