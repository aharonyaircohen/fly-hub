import { describe, expect, it, vi } from "vitest";

import {
  deleteRepositoryLoop,
  listRepositoryLoops,
  prepareRepositoryLoopFile,
  readRepositoryLoop,
  saveRepositoryLoop,
} from "@dashboard/lib/repository-loops";

const loop = {
  id: "ci-repair",
  trigger: { type: "schedule" as const, every: "15m" },
  target: { kind: "workflow" as const, id: "ci-repair" },
  input: {},
  enabled: true,
};

function file(value: unknown = loop, sha = "file-sha") {
  return {
    data: {
      type: "file",
      sha,
      content: Buffer.from(JSON.stringify(value)).toString("base64"),
      html_url: "https://github.test/loop",
    },
  };
}

describe("repository loops", () => {
  it("prepares the exact repository file used by deferred installation", () => {
    expect(prepareRepositoryLoopFile(loop)).toEqual({
      loop,
      path: ".kody-engine/definitions/loops/ci-repair/loop.json",
      content: `${JSON.stringify(loop, null, 2)}\n`,
    });
  });

  it("lists valid Loop definitions from the consumer runtime folder", async () => {
    const getContent = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ type: "dir", name: "ci-repair" }],
      })
      .mockResolvedValueOnce(file());
    const octokit = { repos: { getContent } } as never;

    await expect(listRepositoryLoops(octokit, "o", "r")).resolves.toEqual([
      loop,
    ]);
  });

  it("returns null for a missing Loop", async () => {
    const octokit = {
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      },
    } as never;

    await expect(
      readRepositoryLoop(octokit, "o", "r", "missing"),
    ).resolves.toBeNull();
  });

  it("reads the previous Live Agent target as the current capability target", async () => {
    const octokit = {
      repos: {
        getContent: vi.fn().mockResolvedValue(
          file({
            id: "live-agent-operations-agent",
            trigger: { type: "schedule", every: "1h" },
            target: { kind: "agent", id: "operations-agent" },
            input: { intent: "healthy-operations" },
            enabled: true,
          }),
        ),
      },
    } as never;

    await expect(
      readRepositoryLoop(octokit, "o", "r", "live-agent-operations-agent"),
    ).resolves.toEqual({
      id: "live-agent-operations-agent",
      trigger: { type: "schedule", every: "1h" },
      target: { kind: "capability", id: "live-agent" },
      input: { agent: "operations-agent", intent: "healthy-operations" },
      enabled: true,
    });
  });

  it("writes a Loop to the repository definition path", async () => {
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({
      data: { content: { sha: "new" }, commit: { sha: "commit" } },
    });
    const octokit = {
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
        createOrUpdateFileContents,
      },
    } as never;

    await expect(
      saveRepositoryLoop(octokit, "o", "r", loop, "add loop"),
    ).resolves.toMatchObject({ loop, created: true });
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".kody-engine/definitions/loops/ci-repair/loop.json",
        message: "add loop",
      }),
    );
  });

  it("deletes the exact repository definition file", async () => {
    const deleteFile = vi.fn().mockResolvedValue({ data: {} });
    const octokit = {
      repos: {
        getContent: vi.fn().mockResolvedValue(file()),
        deleteFile,
      },
    } as never;

    await expect(
      deleteRepositoryLoop(octokit, "o", "r", "ci-repair", "remove loop"),
    ).resolves.toBe(true);
    expect(deleteFile).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      path: ".kody-engine/definitions/loops/ci-repair/loop.json",
      message: "remove loop",
      sha: "file-sha",
    });
  });
});
