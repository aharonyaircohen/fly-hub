import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import {
  buildRepositoryPathChanges,
  deleteRepositoryPath,
} from "@dashboard/features/file-manager/lib/repo-file-operations";

describe("buildRepositoryPathChanges", () => {
  it("preserves an executable file's existing Git object and mode", () => {
    expect(
      buildRepositoryPathChanges(
        [
          {
            path: "scripts/release",
            sha: "blob-executable",
            mode: "100755",
            type: "blob",
          },
        ],
        {
          operation: "move",
          sourcePath: "scripts/release",
          sourceType: "file",
          targetPath: "bin/release",
        },
      ),
    ).toEqual([
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
    ]);
  });

  it("preserves symlink mode when renaming a symlink", () => {
    expect(
      buildRepositoryPathChanges(
        [
          {
            path: "current",
            sha: "blob-symlink",
            mode: "120000",
            type: "blob",
          },
        ],
        {
          operation: "move",
          sourcePath: "current",
          sourceType: "symlink",
          targetPath: "latest",
        },
      ),
    ).toEqual([
      {
        path: "latest",
        sha: "blob-symlink",
        mode: "120000",
        type: "blob",
      },
      {
        path: "current",
        sha: null,
        mode: "120000",
        type: "blob",
      },
    ]);
  });

  it("duplicates a folder without reading file bodies or deleting sources", () => {
    expect(
      buildRepositoryPathChanges(
        [
          {
            path: "docs/a.md",
            sha: "blob-a",
            mode: "100644",
            type: "blob",
          },
          {
            path: "docs/bin/tool",
            sha: "blob-tool",
            mode: "100755",
            type: "blob",
          },
          {
            path: "outside.md",
            sha: "blob-outside",
            mode: "100644",
            type: "blob",
          },
        ],
        {
          operation: "duplicate",
          sourcePath: "docs",
          sourceType: "dir",
          targetPath: "docs-copy",
        },
      ),
    ).toEqual([
      {
        path: "docs-copy/a.md",
        sha: "blob-a",
        mode: "100644",
        type: "blob",
      },
      {
        path: "docs-copy/bin/tool",
        sha: "blob-tool",
        mode: "100755",
        type: "blob",
      },
    ]);
  });

  it("deletes a folder in one tree mutation", () => {
    expect(
      buildRepositoryPathChanges(
        [
          {
            path: "archive/a.md",
            sha: "blob-a",
            mode: "100644",
            type: "blob",
          },
          {
            path: "archive/bin/tool",
            sha: "blob-tool",
            mode: "100755",
            type: "blob",
          },
          {
            path: "keep.md",
            sha: "blob-keep",
            mode: "100644",
            type: "blob",
          },
        ],
        {
          operation: "delete",
          sourcePath: "archive",
          sourceType: "dir",
        },
      ),
    ).toEqual([
      {
        path: "archive/a.md",
        sha: null,
        mode: "100644",
        type: "blob",
      },
      {
        path: "archive/bin/tool",
        sha: null,
        mode: "100755",
        type: "blob",
      },
    ]);
  });

  it("re-reads the branch when GitHub briefly returns a stale tree", async () => {
    const getTree = vi
      .fn()
      .mockResolvedValueOnce({ data: { tree: [], truncated: false } })
      .mockResolvedValueOnce({
        data: {
          tree: [
            {
              path: "renamed.md",
              sha: "blob-1",
              mode: "100644",
              type: "blob",
            },
          ],
          truncated: false,
        },
      });
    const octokit = {
      repos: {
        get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
      },
      git: {
        getRef: vi
          .fn()
          .mockResolvedValueOnce({ data: { object: { sha: "old-head" } } })
          .mockResolvedValueOnce({ data: { object: { sha: "new-head" } } }),
        getCommit: vi
          .fn()
          .mockResolvedValueOnce({ data: { tree: { sha: "old-tree" } } })
          .mockResolvedValueOnce({ data: { tree: { sha: "new-tree" } } }),
        getTree,
        createTree: vi.fn().mockResolvedValue({ data: { sha: "next-tree" } }),
        createCommit: vi
          .fn()
          .mockResolvedValue({ data: { sha: "next-commit" } }),
        updateRef: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Octokit;

    await deleteRepositoryPath(
      octokit,
      "owner",
      "repo",
      "renamed.md",
      "file",
    );

    expect(getTree).toHaveBeenCalledTimes(2);
    expect(octokit.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        base_tree: "new-tree",
        tree: [
          {
            path: "renamed.md",
            sha: null,
            mode: "100644",
            type: "blob",
          },
        ],
      }),
    );
  });
});
