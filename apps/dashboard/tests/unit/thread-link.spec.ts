import { describe, expect, it } from "vitest";

import {
  dashboardAgentUrl,
  dashboardCapabilityUrl,
  dashboardCommandUrl,
  dashboardContextUrl,
  dashboardFileUrl,
  dashboardInstructionsUrl,
  dashboardMemoryUrl,
  dashboardTaskUrl,
  dashboardThreadUrl,
  dashboardTodoUrl,
} from "@dashboard/lib/thread-link";

describe("dashboard link helpers", () => {
  it("builds internal links for task and file resources", () => {
    expect(dashboardTaskUrl(123)).toBe("/123");
    expect(
      dashboardTaskUrl(123, { owner: "A-Guy-educ", repo: "A-Guy-Web" }),
    ).toBe("/repo/A-Guy-educ/A-Guy-Web/123");
    expect(dashboardTaskUrl(123, "A-Guy-educ/A-Guy-Web")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/123",
    );
    expect(dashboardFileUrl("app/api/kody/tasks/route.ts")).toBe(
      "/files/app/api/kody/tasks/route.ts",
    );
    expect(dashboardFileUrl("docs/space name.md")).toBe(
      "/files/docs/space%20name.md",
    );
  });

  it("builds internal links for state-backed resources", () => {
    expect(dashboardMemoryUrl("reply-style")).toBe("/memory/reply-style");
    expect(dashboardContextUrl("release-rules")).toBe("/context/release-rules");
    expect(dashboardCapabilityUrl("fix-ci")).toBe("/capabilities/fix-ci");
    expect(dashboardTodoUrl("launch")).toBe("/todos/launch");
    expect(dashboardAgentUrl("qa")).toBe("/agents/qa");
    expect(dashboardCommandUrl("ship")).toBe("/commands");
    expect(dashboardInstructionsUrl()).toBe("/instructions");
  });

  it("maps GitHub issue and PR urls to repo-scoped dashboard links", () => {
    expect(
      dashboardThreadUrl({
        githubUrl: "https://github.com/A-Guy-educ/A-Guy-Web/issues/701",
        threadType: "Issue",
      }),
    ).toBe("/repo/A-Guy-educ/A-Guy-Web/701");
    expect(
      dashboardThreadUrl({
        githubUrl:
          "https://github.com/A-Guy-educ/A-Guy-Web/pull/702#discussion_r1",
        threadType: "PullRequest",
      }),
    ).toBe("/repo/A-Guy-educ/A-Guy-Web/702");
    expect(
      dashboardThreadUrl({
        githubUrl: "https://github.com/A-Guy-educ/A-Guy-Web/commit/abc",
        threadType: "Commit",
      }),
    ).toBe("https://github.com/A-Guy-educ/A-Guy-Web/commit/abc");
  });
});
