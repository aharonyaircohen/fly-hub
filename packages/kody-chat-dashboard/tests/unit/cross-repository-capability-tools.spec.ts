import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCrossRepositoryCapabilityTools } from "../../app/api/kody/chat/tools/cross-repository-capability-tools";

const sourceCapability = {
  capability: {
    slug: "prepare-facebook-post",
    instructions: "Prepare the Facebook post exactly.\n",
    contract: '{"execution":"agent","input":{},"output":{}}\n',
    skills: [{ name: "voice.md", body: "Keep the supplied voice." }],
    capabilityTools: [
      { name: "format.sh", content: "#!/bin/sh\nprintf '{}\\n'\n" },
    ],
    source: "local",
    readOnly: false,
  },
};

const repositories = [
  { owner: "acme", repo: "source" },
  { owner: "acme", repo: "target" },
];

describe("cross-repository capability chat tools", () => {
  const readSource = vi.fn();
  const readTarget = vi.fn();
  const saveTarget = vi.fn();
  const resolveRepository = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readSource.mockReset().mockResolvedValue(sourceCapability);
    readTarget
      .mockReset()
      .mockResolvedValueOnce({ error: "not_found", status: 404 })
      .mockResolvedValue(sourceCapability);
    saveTarget.mockReset().mockResolvedValue({
      capability: { slug: "prepare-facebook-post" },
    });
    resolveRepository
      .mockReset()
      .mockImplementation(
        async (
          repository: { owner: string; repo: string },
          permission: "read" | "write",
        ) => {
          const key = `${repository.owner}/${repository.repo}`;
          if (key === "acme/source" && permission === "read") {
            return {
              owner: "acme",
              repo: "source",
              actorGithubId: 42,
              readCapability: readSource,
              saveCapability: vi.fn(),
            };
          }
          if (key === "acme/target" && permission === "write") {
            return {
              owner: "acme",
              repo: "target",
              actorGithubId: 42,
              readCapability: readTarget,
              saveCapability: saveTarget,
            };
          }
          return null;
        },
      );
  });

  it("lists repository names without exposing credentials", async () => {
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.list_connected_repositories.execute!({}, {} as never),
    ).resolves.toEqual({ repositories });
  });

  it("copies the complete capability between two authorized repositories", async () => {
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.copy_capability.execute!(
        {
          source: { owner: "acme", repo: "source" },
          target: { owner: "acme", repo: "target" },
          slug: "prepare-facebook-post",
          overwrite: false,
        },
        {} as never,
      ),
    ).resolves.toEqual({
      copied: true,
      slug: "prepare-facebook-post",
      source: "acme/source",
      target: "acme/target",
    });

    expect(saveTarget).toHaveBeenCalledWith({
      slug: "prepare-facebook-post",
      instructions: "Prepare the Facebook post exactly.\n",
      contract: '{"execution":"agent","input":{},"output":{}}\n',
      skills: [{ path: "voice.md", content: "Keep the supplied voice." }],
      tools: [{ path: "format.sh", content: "#!/bin/sh\nprintf '{}\\n'\n" }],
    });
  });

  it("does not overwrite an existing target unless explicitly requested", async () => {
    readTarget.mockReset().mockResolvedValue({
      capability: { slug: "prepare-facebook-post" },
    });
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.copy_capability.execute!(
        {
          source: { owner: "acme", repo: "source" },
          target: { owner: "acme", repo: "target" },
          slug: "prepare-facebook-post",
          overwrite: false,
        },
        {} as never,
      ),
    ).resolves.toEqual({
      error: "target_exists",
      message:
        'Capability "prepare-facebook-post" already exists in acme/target. Set overwrite to true only if the user explicitly asked to replace it.',
    });
    expect(saveTarget).not.toHaveBeenCalled();
  });

  it("fails verification when the saved target differs from the source", async () => {
    readTarget
      .mockReset()
      .mockResolvedValueOnce({ error: "not_found", status: 404 })
      .mockResolvedValueOnce({
        capability: {
          ...sourceCapability.capability,
          instructions: "Changed after save.",
        },
      });
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.copy_capability.execute!(
        {
          source: { owner: "acme", repo: "source" },
          target: { owner: "acme", repo: "target" },
          slug: "prepare-facebook-post",
          overwrite: false,
        },
        {} as never,
      ),
    ).resolves.toEqual({ error: "target_verification_failed" });
  });

  it("rejects repositories outside the signed-in account connections", async () => {
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.copy_capability.execute!(
        {
          source: { owner: "other", repo: "private" },
          target: { owner: "acme", repo: "target" },
          slug: "prepare-facebook-post",
          overwrite: false,
        },
        {} as never,
      ),
    ).resolves.toEqual({ error: "source_repository_not_connected" });
    expect(saveTarget).not.toHaveBeenCalled();
  });

  it("rejects a repository credential owned by another GitHub actor", async () => {
    resolveRepository.mockResolvedValue({
      owner: "acme",
      repo: "source",
      actorGithubId: 99,
      readCapability: readSource,
      saveCapability: vi.fn(),
    });
    const tools = createCrossRepositoryCapabilityTools({
      repositories,
      actorGithubId: 42,
      resolveRepository,
    });

    await expect(
      tools.copy_capability.execute!(
        {
          source: { owner: "acme", repo: "source" },
          target: { owner: "acme", repo: "target" },
          slug: "prepare-facebook-post",
          overwrite: false,
        },
        {} as never,
      ),
    ).resolves.toEqual({ error: "repository_actor_mismatch" });
    expect(saveTarget).not.toHaveBeenCalled();
  });
});
