import { describe, expect, it } from "vitest";
import { parseGitHubRepository } from "../../src/dashboard/lib/apps/source-repository";

describe("App source repository", () => {
  it("accepts a GitHub repository URL", () => {
    expect(
      parseGitHubRepository("https://github.com/lfnovo/open-notebook"),
    ).toEqual({
      owner: "lfnovo",
      repo: "open-notebook",
      fullName: "lfnovo/open-notebook",
    });
  });

  it("accepts the canonical owner/repository form", () => {
    expect(parseGitHubRepository("lfnovo/open-notebook")).toMatchObject({
      owner: "lfnovo",
      repo: "open-notebook",
    });
  });

  it.each([
    "https://example.com/lfnovo/open-notebook",
    "https://user:secret@github.com/lfnovo/open-notebook",
    "https://github.com/lfnovo/open-notebook/issues",
    "lfnovo",
  ])("rejects an unsafe or invalid source: %s", (source) => {
    expect(() => parseGitHubRepository(source)).toThrow(
      "invalid_github_repository",
    );
  });
});
