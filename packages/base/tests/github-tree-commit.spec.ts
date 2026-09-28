import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import {
  commitGitHubTreeMutation,
  type GitHubTreeChange,
} from "../src/github-tree-commit";

function createOctokitMock() {
  const getRef = vi.fn().mockResolvedValue({
    data: { object: { sha: "commit-base" } },
  });
  const getCommit = vi.fn().mockResolvedValue({
    data: { tree: { sha: "tree-base" } },
  });
  const createTree = vi.fn().mockResolvedValue({
    data: { sha: "tree-next" },
  });
  const createCommit = vi.fn().mockResolvedValue({
    data: { sha: "commit-next" },
  });
  const updateRef = vi.fn().mockResolvedValue({ data: {} });
  const octokit = {
    git: { getRef, getCommit, createTree, createCommit, updateRef },
  } as unknown as Octokit;

  return {
    octokit,
    getRef,
    getCommit,
    createTree,
    createCommit,
    updateRef,
  };
}

describe("commitGitHubTreeMutation", () => {
  it("builds and commits one atomic tree mutation", async () => {
    const { octokit, getRef, createTree, createCommit, updateRef } =
      createOctokitMock();
    const changes: GitHubTreeChange[] = [
      {
        path: "docs/new.md",
        mode: "100644",
        type: "blob",
        sha: "blob-existing",
      },
      {
        path: "docs/old.md",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ];

    const result = await commitGitHubTreeMutation(
      octokit,
      { owner: "acme", repo: "repo", ref: "main" },
      {
        message: "chore: rename docs/old.md",
        buildChanges: vi.fn().mockResolvedValue(changes),
        retryDelayMs: 0,
      },
    );

    expect(createTree).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      base_tree: "tree-base",
      tree: changes,
    });
    expect(getRef).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "repo",
        ref: "heads/main",
        cache_bust: expect.any(Number),
      }),
    );
    expect(createCommit).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      message: "chore: rename docs/old.md",
      tree: "tree-next",
      parents: ["commit-base"],
    });
    expect(updateRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      ref: "heads/main",
      sha: "commit-next",
      force: false,
    });
    expect(result).toEqual({
      commitSha: "commit-next",
      treeSha: "tree-next",
    });
  });

  it("rebuilds changes from the latest tree after a branch race", async () => {
    const { octokit, getRef, getCommit, createTree, updateRef } =
      createOctokitMock();
    getRef
      .mockResolvedValueOnce({
        data: { object: { sha: "commit-base" } },
      })
      .mockResolvedValueOnce({
        data: { object: { sha: "commit-latest" } },
      });
    getCommit
      .mockResolvedValueOnce({
        data: { tree: { sha: "tree-base" } },
      })
      .mockResolvedValueOnce({
        data: { tree: { sha: "tree-latest" } },
      });
    updateRef
      .mockRejectedValueOnce({
        status: 422,
        message: "Update is not a fast forward",
      })
      .mockResolvedValueOnce({ data: {} });
    const buildChanges = vi.fn().mockResolvedValue([
      {
        path: "renamed.md",
        mode: "100644",
        type: "blob",
        sha: "blob-existing",
      },
    ]);

    await commitGitHubTreeMutation(
      octokit,
      { owner: "acme", repo: "repo", ref: "main" },
      {
        message: "chore: rename file",
        buildChanges,
        retryDelayMs: 0,
      },
    );

    expect(buildChanges).toHaveBeenNthCalledWith(1, {
      headSha: "commit-base",
      treeSha: "tree-base",
    });
    expect(buildChanges).toHaveBeenNthCalledWith(2, {
      headSha: "commit-latest",
      treeSha: "tree-latest",
    });
    expect(createTree).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate paths before writing a Git tree", async () => {
    const { octokit, createTree } = createOctokitMock();

    await expect(
      commitGitHubTreeMutation(
        octokit,
        { owner: "acme", repo: "repo", ref: "main" },
        {
          message: "invalid",
          buildChanges: async () => [
            {
              path: "same.md",
              mode: "100644",
              type: "blob",
              sha: "blob-a",
            },
            {
              path: "same.md",
              mode: "100644",
              type: "blob",
              sha: null,
            },
          ],
          retryDelayMs: 0,
        },
      ),
    ).rejects.toThrow("Duplicate Git tree path: same.md");

    expect(createTree).not.toHaveBeenCalled();
  });
});
