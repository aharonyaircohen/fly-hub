import { describe, expect, it, vi } from "vitest";

import { createGitHubTools } from "../../app/api/kody/chat/tools/github-tools";

function createOctokit() {
  return {
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({
          data: { default_branch: "main" },
        }),
        getContent: vi.fn().mockResolvedValue({
          data: {
            type: "file",
            path: "README.md",
            sha: "blob-sha",
            size: 5,
            encoding: "base64",
            content: Buffer.from("hello").toString("base64"),
          },
        }),
      },
    },
  };
}

describe("GitHub tool ref contract", () => {
  it("returns the resolved default branch and labels a file hash as a blob", async () => {
    const octokit = createOctokit();
    const tools = createGitHubTools({
      octokit: octokit as never,
      owner: "owner",
      repo: "repo",
    });

    const result = await tools.github_get_file.execute?.(
      { path: "README.md" },
      {} as never,
    );

    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      path: "README.md",
      ref: "main",
    });
    expect(result).toMatchObject({
      kind: "file",
      path: "README.md",
      ref: "main",
      blobSha: "blob-sha",
    });
    expect(result).not.toHaveProperty("sha");
  });

  it("treats the old synthetic default marker as the default branch", async () => {
    const octokit = createOctokit();
    const tools = createGitHubTools({
      octokit: octokit as never,
      owner: "owner",
      repo: "repo",
    });

    const result = await tools.github_get_file.execute?.(
      { path: "README.md", ref: "default" },
      {} as never,
    );

    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "main" }),
    );
    expect(result).toMatchObject({ ref: "main" });
  });

  it("preserves a real explicit branch without resolving the default", async () => {
    const octokit = createOctokit();
    const tools = createGitHubTools({
      octokit: octokit as never,
      owner: "owner",
      repo: "repo",
    });

    const result = await tools.github_get_file.execute?.(
      { path: "README.md", ref: "release" },
      {} as never,
    );

    expect(octokit.rest.repos.get).not.toHaveBeenCalled();
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "release" }),
    );
    expect(result).toMatchObject({ ref: "release" });
  });

  it("suggests real repository paths when a guessed file path is missing", async () => {
    const octokit = createOctokit();
    octokit.rest.repos.getContent.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    Object.assign(octokit.rest.repos, {
      getCommit: vi.fn().mockResolvedValue({
        data: { commit: { tree: { sha: "tree-sha" } } },
      }),
    });
    Object.assign(octokit.rest, {
      git: {
        getTree: vi.fn().mockResolvedValue({
          data: {
            tree: [
              {
                path: "apps/dashboard/src/dashboard/features/previews/components/PreviewWorkspace.tsx",
                type: "blob",
              },
              { path: "README.md", type: "blob" },
            ],
          },
        }),
      },
    });
    const tools = createGitHubTools({
      octokit: octokit as never,
      owner: "owner",
      repo: "repo",
    });

    const result = await tools.github_get_file.execute?.(
      {
        path: "packages/kody-chat-dashboard/app/preview/PreviewWorkspace.tsx",
      },
      {} as never,
    );

    expect(result).toMatchObject({
      error: "Not Found",
      suggestedPaths: [
        "apps/dashboard/src/dashboard/features/previews/components/PreviewWorkspace.tsx",
      ],
    });
  });
});
