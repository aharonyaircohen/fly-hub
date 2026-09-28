import { describe, expect, it } from "vitest";

import {
  legacyRepoRedirectPath,
  parseRepoScopedPath,
  repoPathForNavMatching,
  repoScopedPath,
  repoScopedHref,
  repoSwitchRedirectPath,
  resolveRepoRouteAuthSync,
  routes,
} from "@kody-ade/base/routes";

const repo = { owner: "A-Guy-educ", repo: "A-Guy-Web" };

describe("repo-scoped route contract", () => {
  it("builds canonical repo workspace paths", () => {
    expect(routes.repoHome(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web");
    expect(routes.repoTasks(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web/tasks");
    expect(routes.repoTask(repo, 123)).toBe("/repo/A-Guy-educ/A-Guy-Web/123");
    expect(routes.repoTaskPreview(repo, 123)).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/123/preview",
    );
    expect(routes.repoTaskPreview(repo, 123, "docs")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/123/preview/docs",
    );
  });

  it("keeps repo-owned pages under the selected repo", () => {
    expect(routes.repoFiles(repo, "src/app/page.tsx")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/files/src/app/page.tsx",
    );
    expect(routes.repoDocs(repo, "docs/hello world.md")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/docs/docs/hello%20world.md",
    );
    expect(routes.repoReports(repo, "release-health")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/reports/release-health",
    );
    expect(routes.repoTodos(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web/todos");
    expect(routes.repoTodoList(repo, "launch-plan")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/todos/launch-plan",
    );
    expect(routes.repoTodoItem(repo, "launch-plan", "ship-checklist")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/todos/launch-plan/ship-checklist",
    );
    expect(routes.repoSecrets(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web/secrets");
    expect(routes.repoConnections(repo)).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/connections",
    );
    expect(routes.repoConfig(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web/config");
  });

  it("leaves global routes outside the repo workspace", () => {
    expect(routes.orgHome()).toBe("/org");
    expect(routes.org("A-Guy-educ")).toBe("/org/A-Guy-educ");
  });

  it("builds generic repo-scoped child paths safely", () => {
    expect(repoScopedPath(repo, "/content/entries/blog/new post")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/content/entries/blog/new%20post",
    );
    expect(repoScopedPath(repo)).toBe("/repo/A-Guy-educ/A-Guy-Web");
  });

  it("scopes repo-owned hrefs while leaving global hrefs alone", () => {
    expect(repoScopedHref(repo, "/tasks")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/tasks",
    );
    expect(repoScopedHref(repo, "/reports?run=latest#summary")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/reports?run=latest#summary",
    );
    expect(repoScopedHref(repo, "/file-spaces/team-notes")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/file-spaces/team-notes",
    );
    expect(repoScopedHref(repo, "/views/widgets/question-select")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/views/widgets/question-select",
    );
    expect(repoScopedHref(repo, "/brain")).toBe("/brain");
    expect(repoScopedHref(repo, "/org")).toBe("/org");
    expect(repoScopedHref(repo, "/repo/A-Guy-educ/A-Guy-Web/tasks")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/tasks",
    );
  });

  it("moves the current repo-owned page to the newly selected repo", () => {
    const nextRepo = { owner: "OtherOrg", repo: "OtherRepo" };

    expect(
      repoSwitchRedirectPath(
        nextRepo,
        "/repo/A-Guy-educ/A-Guy-Web/tasks?filter=open#top",
      ),
    ).toBe("/repo/OtherOrg/OtherRepo/tasks?filter=open#top");
    expect(repoSwitchRedirectPath(nextRepo, "/todos/launch-plan")).toBe(
      "/repo/OtherOrg/OtherRepo/todos/launch-plan",
    );
    expect(repoSwitchRedirectPath(nextRepo, "/org/A-Guy-educ")).toBe(
      "/repo/OtherOrg/OtherRepo",
    );
  });

  it("normalizes repo-scoped paths for shared nav matching", () => {
    expect(repoPathForNavMatching("/repo/A-Guy-educ/A-Guy-Web")).toBe("/");
    expect(repoPathForNavMatching("/repo/A-Guy-educ/A-Guy-Web/tasks")).toBe(
      "/tasks",
    );
    expect(
      repoPathForNavMatching("/repo/A-Guy-educ/A-Guy-Web/123/preview/docs"),
    ).toBe("/123/preview/docs");
    expect(repoPathForNavMatching("/org/A-Guy-educ")).toBe("/org/A-Guy-educ");
  });

  it("parses repo-scoped paths without treating similarly named routes as repos", () => {
    expect(
      parseRepoScopedPath("/repo/A-Guy-educ/A-Guy-Web/files/src/app.ts"),
    ).toEqual({
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
      restSegments: ["files", "src", "app.ts"],
      restPath: "/files/src/app.ts",
    });
    expect(parseRepoScopedPath("/repository/A-Guy-educ/A-Guy-Web")).toBeNull();
    expect(parseRepoScopedPath("/repo/A-Guy-educ")).toBeNull();
  });

  it("maps legacy repo-owned routes into the selected repo workspace", () => {
    expect(legacyRepoRedirectPath(repo, "/")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web",
    );
    expect(legacyRepoRedirectPath(repo, "/tasks")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/tasks",
    );
    expect(legacyRepoRedirectPath(repo, "/123/comments")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/123/comments",
    );
    expect(legacyRepoRedirectPath(repo, "/files/src/app.tsx")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/files/src/app.tsx",
    );
    expect(legacyRepoRedirectPath(repo, "/brain")).toBeNull();
    expect(legacyRepoRedirectPath(repo, "/content/entries/blog/post-1")).toBe(
      "/repo/A-Guy-educ/A-Guy-Web/content/entries/blog/post-1",
    );
  });

  it("does not redirect global or already repo-scoped routes", () => {
    expect(legacyRepoRedirectPath(repo, "/org")).toBeNull();
    expect(legacyRepoRedirectPath(repo, "/org/A-Guy-educ")).toBeNull();
    expect(
      legacyRepoRedirectPath(repo, "/repo/A-Guy-educ/A-Guy-Web/tasks"),
    ).toBeNull();
  });

  it("keeps repo-scoped routes on the matching current repo", () => {
    expect(
      resolveRepoRouteAuthSync("/repo/A-Guy-educ/A-Guy-Web/tasks", {
        owner: "A-Guy-educ",
        repo: "A-Guy-Web",
        currentRepoIndex: 0,
        repos: [{ owner: "A-Guy-educ", repo: "A-Guy-Web" }],
      }),
    ).toEqual({ status: "current" });
  });

  it("switches repo-scoped routes to an attached repo before rendering", () => {
    expect(
      resolveRepoRouteAuthSync("/repo/A-Guy-educ/A-Guy-Web/tasks", {
        owner: "aharonyaircohen",
        repo: "Kody-Dashboard",
        currentRepoIndex: 0,
        repos: [
          { owner: "aharonyaircohen", repo: "Kody-Dashboard" },
          { owner: "A-Guy-educ", repo: "A-Guy-Web" },
        ],
      }),
    ).toEqual({ status: "switch", index: 1 });
  });

  it("blocks repo-scoped routes for repos that are not attached", () => {
    expect(
      resolveRepoRouteAuthSync("/repo/A-Guy-educ/A-Guy-Web/tasks", {
        owner: "aharonyaircohen",
        repo: "Kody-Dashboard",
        currentRepoIndex: 0,
        repos: [{ owner: "aharonyaircohen", repo: "Kody-Dashboard" }],
      }),
    ).toEqual({
      status: "missing",
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
    });
  });
});
