import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { createGitHubFilesTransport } from "@dashboard/features/file-manager/lib/github-files-transport";

function createOctokitMock() {
  const createTree = vi.fn().mockResolvedValue({
    data: { sha: "tree-next" },
  });
  const octokit = {
    repos: {
      get: vi.fn().mockResolvedValue({
        data: { default_branch: "main" },
      }),
    },
    git: {
      getRef: vi.fn().mockResolvedValue({
        data: { object: { sha: "commit-base" } },
      }),
      getCommit: vi.fn().mockResolvedValue({
        data: { tree: { sha: "tree-base" } },
      }),
      getTree: vi.fn().mockResolvedValue({
        data: {
          truncated: false,
          tree: [
            {
              path: "scripts/release",
              sha: "blob-executable",
              mode: "100755",
              type: "blob",
            },
          ],
        },
      }),
      createTree,
      createCommit: vi.fn().mockResolvedValue({
        data: { sha: "commit-next" },
      }),
      updateRef: vi.fn().mockResolvedValue({ data: {} }),
    },
  } as unknown as Octokit;

  return { octokit, createTree };
}

describe("createGitHubFilesTransport", () => {
  it("owns atomic path moves without exposing GitHub details to the caller", async () => {
    const { octokit, createTree } = createOctokitMock();
    const transport = createGitHubFilesTransport(octokit, "acme", "repo");

    await transport.movePath?.({
      sourcePath: "scripts/release",
      sourceType: "file",
      targetPath: "bin/release",
    });

    expect(createTree).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      base_tree: "tree-base",
      tree: [
        {
          path: "bin/release",
          sha: "blob-executable",
          mode: "100755",
          type: "blob",
        },
        {
          path: "scripts/release",
          sha: null,
          mode: "100755",
          type: "blob",
        },
      ],
    });
  });

  it("exposes structural capabilities through the generic transport contract", () => {
    const { octokit } = createOctokitMock();
    const transport = createGitHubFilesTransport(octokit, "acme", "repo");

    expect(transport).toMatchObject({
      listDir: expect.any(Function),
      readFile: expect.any(Function),
      writeFile: expect.any(Function),
      deleteFile: expect.any(Function),
      createFolder: expect.any(Function),
      uploadFile: expect.any(Function),
      movePath: expect.any(Function),
      duplicatePath: expect.any(Function),
      externalUrl: expect.any(Function),
    });
  });
});
