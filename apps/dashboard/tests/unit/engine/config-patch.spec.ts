/**
 * @fileoverview Unit tests for `writeConfigPatch` reasoningEffort handling.
 * @testFramework vitest
 * @domain engine-config
 *
 * Three regression scenarios for the reasoningEffort patch flow:
 *   1. A patch that doesn't touch reasoning must preserve any pre-existing
 *      `agent.reasoningEffort` (and every other agent field).
 *   2. A patch with `reasoningEffort: null` must clear only that field,
 *      keeping `agent.model` and `agent.perImplementation` intact.
 *   3. A patch with a valid reasoning effort ("low"/"medium"/"high"/"off")
 *      must write the value to `agent.reasoningEffort`.
 *
 * The first one is the load-bearing one — the original regression was that
 * the route coalesced an omitted `reasoningEffort` to `null` before calling
 * this function, turning every quality-only PATCH into an effective clear.
 * The function itself was already correct; these tests pin its contract.
 */

import { describe, expect, it, vi } from "vitest";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@kody-ade/base/engine/config";

function encodeConfig(config: unknown): string {
  return Buffer.from(JSON.stringify(config), "utf-8").toString("base64");
}

function contentResponse(config: unknown, sha: string) {
  return {
    data: {
      content: encodeConfig(config),
      sha,
    },
  };
}

function decodeConfigWrite(write: Record<string, unknown>) {
  return JSON.parse(
    Buffer.from(write.content as string, "base64").toString("utf-8"),
  );
}

function octokitWithConfig(config: unknown) {
  const writes: Array<Record<string, unknown>> = [];
  const octokit = {
    rest: {
      repos: {
        getContent: vi.fn().mockResolvedValue(contentResponse(config, "sha-1")),
        createOrUpdateFileContents: vi
          .fn()
          .mockImplementation(async (p: Record<string, unknown>) => {
            writes.push(p);
            return { data: { commit: { sha: "commit-1" } } };
          }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const lastWritten = () => decodeConfigWrite(writes.at(-1)!);
  return { octokit, lastWritten, writes };
}

describe("getEngineConfig", () => {
  it("preserves repository Capability bindings", async () => {
    const { octokit } = octokitWithConfig({
      github: { owner: "o", repo: "r" },
      execution: {
        capabilityBindings: { "build-report": "pdf-renderer" },
      },
    });

    const { config } = await getEngineConfig(octokit, "o", "binding-read", {
      force: true,
    });

    expect(config.execution?.capabilityBindings).toEqual({
      "build-report": "pdf-renderer",
    });
  });
});

describe("writeConfigPatch — Capability bindings", () => {
  it("writes cleaned bindings under execution without changing other execution settings", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      github: { owner: "o", repo: "r" },
      execution: { transport: "github-actions" },
    });

    await writeConfigPatch(octokit, "o", "r", {
      capabilityBindings: {
        "build-report": "pdf-renderer",
        "Bad Capability": "ignored",
      },
    });

    expect(lastWritten().execution).toEqual({
      transport: "github-actions",
      capabilityBindings: { "build-report": "pdf-renderer" },
    });
  });
});

describe("writeConfigPatch — reasoningEffort", () => {
  it("patch with only `quality` preserves the existing agent.reasoningEffort", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      defaultImplementation: "run",
      github: { owner: "o", repo: "r" },
      agent: {
        model: "minimax/MiniMax-M3",
        perImplementation: { research: "anthropic/claude-opus-4-7" },
        reasoningEffort: "medium",
      },
    });

    // Patch touches only quality — the `reasoningEffort` key is absent
    // (this is what the route must do after the fix).
    await writeConfigPatch(octokit, "o", "r", {
      quality: { typecheck: "tsc --noEmit" },
    });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBe("medium");
    expect(written.agent?.model).toBe("minimax/MiniMax-M3");
    expect(written.agent?.perImplementation).toEqual({
      research: "anthropic/claude-opus-4-7",
    });
    expect(written.quality).toEqual({ typecheck: "tsc --noEmit" });
  });

  it("patch with reasoningEffort: null clears only that field, keeping model and perImplementation", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      defaultImplementation: "run",
      github: { owner: "o", repo: "r" },
      agent: {
        model: "minimax/MiniMax-M3",
        perImplementation: { research: "anthropic/claude-opus-4-7" },
        reasoningEffort: "high",
      },
    });

    await writeConfigPatch(octokit, "o", "r", { reasoningEffort: null });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBeUndefined();
    expect(written.agent?.model).toBe("minimax/MiniMax-M3");
    expect(written.agent?.perImplementation).toEqual({
      research: "anthropic/claude-opus-4-7",
    });
  });

  it("patch with a valid reasoning effort writes agent.reasoningEffort", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      defaultImplementation: "run",
      github: { owner: "o", repo: "r" },
      agent: { model: "anthropic/claude-sonnet-4-6" },
    });

    await writeConfigPatch(octokit, "o", "r", { reasoningEffort: "low" });

    const written = lastWritten();
    expect(written.agent?.reasoningEffort).toBe("low");
    expect(written.agent?.model).toBe("anthropic/claude-sonnet-4-6");
  });
});

describe("writeConfigPatch — store activation", () => {
  it("writes active store references under company without copying assets", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      defaultImplementation: "run",
      github: { owner: "o", repo: "r" },
      company: { ownerNote: "keep" },
    });

    await writeConfigPatch(octokit, "o", "r", {
      activeAgents: ["cto", "cto", "qa"],
      activeCapabilities: ["run", "run", "fix-ci"],
      activeWorkflows: ["release-readiness", "release-readiness"],
    });

    const written = lastWritten();
    expect(written.company).toEqual({
      ownerNote: "keep",
      activeAgents: ["cto", "qa"],
      activeCapabilities: ["run", "fix-ci"],
      activeWorkflows: ["release-readiness"],
    });
    expect(written[".kody"]).toBeUndefined();
  });

  it("clears active store references without clearing other company keys", async () => {
    const { octokit, lastWritten } = octokitWithConfig({
      defaultImplementation: "run",
      github: { owner: "o", repo: "r" },
      company: {
        ownerNote: "keep",
        activeAgents: ["cto"],
        activeCapabilities: ["run"],
        activeWorkflows: ["release-readiness"],
      },
    });

    await writeConfigPatch(octokit, "o", "r", {
      activeAgents: null,
      activeCapabilities: null,
      activeWorkflows: null,
    });

    const written = lastWritten();
    expect(written.company).toEqual({ ownerNote: "keep" });
  });

  it("retries active store reference writes after a stale GitHub contents sha", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const staleShaError = Object.assign(
      new Error(
        "kody.config.json does not match sha-stale - https://docs.github.com/rest/repos/contents#create-or-update-file-contents",
      ),
      { status: 409 },
    );
    const octokit = {
      rest: {
        repos: {
          getContent: vi
            .fn()
            .mockResolvedValueOnce(
              contentResponse(
                {
                  defaultImplementation: "run",
                  github: { owner: "o", repo: "r" },
                  company: {
                    ownerNote: "stale",
                    activeCapabilities: ["run", "fix-ci"],
                  },
                },
                "sha-stale",
              ),
            )
            .mockResolvedValueOnce(
              contentResponse(
                {
                  defaultImplementation: "run",
                  github: { owner: "o", repo: "r" },
                  aliases: { deploy: "run" },
                  company: {
                    ownerNote: "fresh",
                    activeAgents: ["cto"],
                    activeCapabilities: ["run", "fix-ci"],
                  },
                },
                "sha-fresh",
              ),
            ),
          createOrUpdateFileContents: vi
            .fn()
            .mockImplementationOnce(async (p: Record<string, unknown>) => {
              writes.push(p);
              throw staleShaError;
            })
            .mockImplementationOnce(async (p: Record<string, unknown>) => {
              writes.push(p);
              return { data: { commit: { sha: "commit-2" } } };
            }),
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      writeConfigPatch(octokit, "o", "r", {
        activeCapabilities: ["run"],
      }),
    ).resolves.toEqual({ sha: "commit-2" });

    expect(octokit.rest.repos.getContent).toHaveBeenCalledTimes(2);
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(
      2,
    );
    expect(writes[0]?.sha).toBe("sha-stale");
    expect(writes[1]?.sha).toBe("sha-fresh");
    const written = decodeConfigWrite(writes[1]!);
    expect(written.aliases).toEqual({ deploy: "run" });
    expect(written.company).toEqual({
      ownerNote: "fresh",
      activeAgents: ["cto"],
      activeCapabilities: ["run"],
    });
  });
});
