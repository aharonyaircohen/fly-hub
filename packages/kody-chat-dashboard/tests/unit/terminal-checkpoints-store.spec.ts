/**
 * @fileoverview Unit coverage for durable terminal checkpoints.
 * @testFramework vitest
 * @domain terminal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readBackendDoc: vi.fn(),
  writeBackendDoc: vi.fn(),
}));

vi.mock("@kody-ade/base/backend/repo-docs", () => ({
  readBackendDoc: stateRepo.readBackendDoc,
  writeBackendDoc: stateRepo.writeBackendDoc,
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  TERMINAL_CHECKPOINT_OUTPUT_LIMIT,
  terminalCheckpointId,
  terminalCheckpointKey,
  terminalCheckpointsPath,
} from "@kody-ade/terminal/checkpoint-types";
import {
  deleteTerminalCheckpoint,
  getTerminalCheckpoint,
  readTerminalCheckpoints,
  upsertTerminalCheckpoint,
} from "@kody-ade/terminal/checkpoint-store";

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("terminal checkpoint store", () => {
  it("stores checkpoints in one document per verified user", async () => {
    stateRepo.readBackendDoc.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({ version: 1, checkpoints: [] }),
    });

    const result = await readTerminalCheckpoints(
      fakeOctokit(),
      "acme",
      "widgets",
      "Alice",
    );

    expect(result.doc.checkpoints).toEqual([]);
    expect(stateRepo.readBackendDoc).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      terminalCheckpointsPath("Alice"),
      { headers: { "If-None-Match": "" } },
    );
  });

  it("keys Brain checkpoints once per user, not per Fly machine", () => {
    const first = terminalCheckpointKey({
      transport: {
        type: "fly",
        app: "brain-a",
        machineId: "machine-a",
        feature: "brain",
      },
      chatSessionId: "chat-1",
    });
    const second = terminalCheckpointKey({
      transport: {
        type: "fly",
        app: "brain-b",
        machineId: "machine-b",
        feature: "brain",
      },
      chatSessionId: "chat-2",
    });
    const runner = terminalCheckpointKey({
      transport: {
        type: "fly",
        app: "runner",
        machineId: "machine-a",
        feature: "runner",
      },
      chatSessionId: "chat-1",
    });

    expect(first).toBe("brain:user");
    expect(second).toBe(first);
    expect(runner).toBe("fly:runner:machine-a");
  });

  it("upserts one checkpoint per terminal key and caps output", async () => {
    const localTransport = { type: "local" as const };
    const localKey = terminalCheckpointKey({
      transport: localTransport,
      chatSessionId: "chat-1",
    });
    stateRepo.readBackendDoc.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        checkpoints: [
          {
            id: terminalCheckpointId(localKey),
            key: localKey,
            transport: localTransport,
            chatSessionId: "chat-1",
            output: "old",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
          {
            id: "other",
            key: "github-actions:sandbox-1",
            transport: { type: "github-actions", sandboxId: "sandbox-1" },
            chatSessionId: "chat-2",
            output: "keep",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });
    stateRepo.writeBackendDoc.mockResolvedValue({ sha: "sha-2" });

    const result = await upsertTerminalCheckpoint(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
      {
        transport: localTransport,
        chatSessionId: "chat-1",
        cwd: "/repo",
        shell: "zsh",
        output: "x".repeat(TERMINAL_CHECKPOINT_OUTPUT_LIMIT + 20),
      },
      new Date("2026-06-24T01:00:00.000Z"),
    );

    expect(result.checkpoint.id).toBe(terminalCheckpointId(localKey));
    expect(result.checkpoint.output).toHaveLength(
      TERMINAL_CHECKPOINT_OUTPUT_LIMIT,
    );
    expect(result.doc.checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      localKey,
    ]);
    const write = stateRepo.writeBackendDoc.mock.calls[0][0];
    expect(write).toMatchObject({
      owner: "acme",
      repo: "widgets",
      path: terminalCheckpointsPath("alice"),
      message: "chore(dashboard): save terminal checkpoint",
    });
  });

  it("does not rewrite an unchanged checkpoint", async () => {
    const transport = { type: "fly" as const, app: "brain", machineId: "m1" };
    const key = terminalCheckpointKey({
      transport,
      chatSessionId: "chat-1",
    });
    stateRepo.readBackendDoc.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        checkpoints: [
          {
            id: terminalCheckpointId(key),
            key,
            transport,
            chatSessionId: "chat-1",
            cwd: "/repo",
            shell: "bash",
            output: "same output",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });

    const result = await upsertTerminalCheckpoint(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
      {
        transport,
        chatSessionId: "chat-1",
        cwd: "/repo",
        shell: "bash",
        output: "same output",
      },
      new Date("2026-06-24T00:10:00.000Z"),
    );

    expect(result.checkpoint.updatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(stateRepo.writeBackendDoc).not.toHaveBeenCalled();
  });

  it("reads and deletes the checkpoint for the current terminal key", async () => {
    const keepTransport = { type: "local" as const };
    const dropTransport = {
      type: "fly" as const,
      app: "runner",
      machineId: "m2",
    };
    const keepKey = terminalCheckpointKey({
      transport: keepTransport,
      chatSessionId: "chat-1",
    });
    const dropKey = terminalCheckpointKey({
      transport: dropTransport,
      chatSessionId: "chat-2",
    });
    stateRepo.readBackendDoc.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        checkpoints: [
          {
            id: terminalCheckpointId(keepKey),
            key: keepKey,
            transport: keepTransport,
            chatSessionId: "chat-1",
            output: "keep",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
          {
            id: terminalCheckpointId(dropKey),
            key: dropKey,
            transport: dropTransport,
            chatSessionId: "chat-2",
            output: "drop",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });
    stateRepo.writeBackendDoc.mockResolvedValue({ sha: "sha-2" });

    await expect(
      getTerminalCheckpoint(fakeOctokit(), "acme", "widgets", "alice", {
        transport: dropTransport,
        chatSessionId: "chat-2",
      }),
    ).resolves.toMatchObject({ checkpoint: { output: "drop" } });

    const deleted = await deleteTerminalCheckpoint(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
      { transport: dropTransport, chatSessionId: "chat-2" },
    );

    expect(deleted.deleted?.key).toBe(dropKey);
    expect(deleted.doc.checkpoints.map((checkpoint) => checkpoint.key)).toEqual(
      [keepKey],
    );
  });

  it("ignores legacy sandbox checkpoint records without losing valid entries", async () => {
    const localTransport = { type: "local" as const };
    const localKey = terminalCheckpointKey({
      transport: localTransport,
      chatSessionId: "chat-1",
    });
    stateRepo.readBackendDoc.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        checkpoints: [
          {
            id: terminalCheckpointId(localKey),
            key: localKey,
            transport: localTransport,
            chatSessionId: "chat-1",
            output: "keep",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
          {
            id: "legacy",
            key: "github-actions:sandbox-1",
            transport: { type: "github-actions", sandboxId: "sandbox-1" },
            chatSessionId: "chat-2",
            output: "drop",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });

    const result = await readTerminalCheckpoints(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
    );

    expect(result.doc.checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      localKey,
    ]);
  });
});
