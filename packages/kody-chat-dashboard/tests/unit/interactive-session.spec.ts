import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const mutation = vi.fn();

vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query, mutation }),
}));

import {
  appendUserTurn,
  buildMetaLine,
  readSessionTranscript,
  writeSessionMeta,
} from "../../src/dashboard/lib/standalone-interactive-session";

const META = buildMetaLine({ idleExitMs: 120_000, hardCapMs: 300_000 });
const TURN = {
  role: "user" as const,
  content: "hello",
  timestamp: "2025-01-01T00:00:00.000Z",
};

describe("Convex-backed interactive sessions", () => {
  beforeEach(() => {
    query.mockReset();
    mutation.mockReset().mockResolvedValue("id");
    query.mockResolvedValue(null);
  });

  it("stores session metadata and the optional initial turn", async () => {
    await writeSessionMeta({} as never, "o", "r", "sess-1", META, undefined, undefined, TURN);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      tenantId: "o/r",
      conversationId: "sess-1",
      surface: "global",
      runtime: { kind: "live" },
    });
    expect(mutation.mock.calls[1]?.[1]).toMatchObject({
      tenantId: "o/r",
      conversationId: "sess-1",
      entry: { kind: "message", role: "user", content: "hello" },
    });
  });

  it("promotes an existing direct conversation to the live runtime", async () => {
    query.mockResolvedValue({
      conversation: {
        runtime: { kind: "direct", modelId: "kody-live-fly" },
      },
    });

    await writeSessionMeta({} as never, "o", "r", "sess-1", META);

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      tenantId: "o/r",
      conversationId: "sess-1",
      runtime: { kind: "live", profileId: "kody-live" },
    });
  });

  it("appends a turn and returns the Convex turn count", async () => {
    query
      .mockResolvedValueOnce({
        conversation: { activeAgent: { slug: "kody", title: "Kody" } },
      })
      .mockResolvedValueOnce({
        entries: [
          { entry: { kind: "message" } },
          { entry: { kind: "message" } },
        ],
      });
    await expect(
      appendUserTurn({} as never, "o", "r", "sess-2", TURN),
    ).resolves.toEqual({ turnCount: 2 });
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      tenantId: "o/r",
      conversationId: "sess-2",
      entry: { kind: "message", role: "user", content: "hello" },
    });
  });

  it("reads the ordered Convex transcript", async () => {
    query.mockResolvedValue({
      entries: [
        {
          seq: 1,
          entry: {
            kind: "message",
            role: "user",
            content: "second",
            createdAt: TURN.timestamp,
          },
        },
        {
          seq: 0,
          entry: {
            kind: "message",
            role: "user",
            content: "hello",
            createdAt: TURN.timestamp,
          },
        },
      ],
    });
    const result = await readSessionTranscript("o", "r", "sess-3");
    expect(result?.meta.mode).toBe("interactive");
    expect(result?.turns).toEqual([TURN, { ...TURN, content: "second" }]);
  });

  it("returns null for an unknown session", async () => {
    query.mockResolvedValue(null);
    await expect(readSessionTranscript("o", "r", "missing")).resolves.toBeNull();
  });
});
