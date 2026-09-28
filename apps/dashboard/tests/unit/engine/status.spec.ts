import { describe, expect, it, vi } from "vitest";

import { getEngineSetupStatus } from "@dashboard/lib/engine/status";

function octokitWithFiles(files: ReadonlySet<string>) {
  const getContent = vi.fn(async ({ path }: { path: string }) => {
    if (!files.has(path)) {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    }
    return { data: { type: "file", path, sha: `${path}-sha` } };
  });
  return {
    getContent,
    octokit: {
      rest: {
        repos: {
          getContent,
        },
      },
    } as never,
  };
}

describe("getEngineSetupStatus", () => {
  it("is ready only when both installer-owned files exist", async () => {
    await expect(
      getEngineSetupStatus({
        octokit: octokitWithFiles(
          new Set([".github/workflows/kody.yml", "kody.config.json"]),
        ).octokit,
        owner: "acme",
        repo: "widgets",
      }),
    ).resolves.toEqual({
      status: "ready",
      files: { workflow: "present", config: "present" },
    });
  });

  it("requires setup when either installer-owned file is missing", async () => {
    await expect(
      getEngineSetupStatus({
        octokit: octokitWithFiles(new Set(["kody.config.json"])).octokit,
        owner: "acme",
        repo: "widgets",
      }),
    ).resolves.toEqual({
      status: "setup_required",
      files: { workflow: "missing", config: "present" },
    });
  });

  it("returns unknown instead of a false setup prompt when GitHub denies access", async () => {
    const mocked = octokitWithFiles(new Set());
    mocked.getContent.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    await expect(
      getEngineSetupStatus({
        octokit: mocked.octokit,
        owner: "acme",
        repo: "widgets",
      }),
    ).resolves.toEqual({
      status: "unknown",
      files: { workflow: "unknown", config: "unknown" },
      error: "github_access_failed",
    });
  });
});
