/**
 * Unit tests for the Convex transcript record in
 * src/dashboard/lib/interactive-session.ts: all runner modes use the shared
 * conversation timeline, and a Convex outage fails closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import {
  appendUserTurn,
  buildMetaLine,
  readSessionTranscript,
  writeSessionMeta,
} from "@dashboard/lib/interactive-session";

/** Octokit double: getContent 404 (new file), create always succeeds. */
function makeOctokit() {
  return {
    repos: {
      getContent: vi.fn(async () => {
        const err = new Error("not found") as Error & { status: number };
        err.status = 404;
        throw err;
      }),
      createOrUpdateFileContents: vi.fn(async () => ({ data: {} })),
    },
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: "state-sha" } } })),
      createRef: vi.fn(),
    },
  } as unknown as Octokit;
}

const META = buildMetaLine({ idleExitMs: 60_000 });
const TURN = {
  role: "user" as const,
  content: "hello",
  timestamp: "2026-07-15T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
  convex.mutation.mockResolvedValue("id");
  convex.query.mockResolvedValue(null);
});

describe("writeSessionMeta convex record", () => {
  it("creates a canonical conversation under the owner/repo tenant", async () => {
    await writeSessionMeta(makeOctokit(), "acme", "widgets", "s1", META);

    expect(convex.mutation).toHaveBeenCalledTimes(1);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("conversations:create");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      conversationId: "s1",
      scope: { kind: "repository", owner: "acme", repo: "widgets" },
      runtime: { kind: "live", profileId: "kody-live" },
    });
  });

  it("records the initial turn in the same start", async () => {
    convex.query.mockResolvedValueOnce(null).mockResolvedValueOnce({
      conversation: { activeAgent: { slug: "kody", title: "Kody" } },
    });
    await writeSessionMeta(
      makeOctokit(),
      "acme",
      "widgets",
      "s1",
      META,
      "main",
      4,
      TURN,
    );

    expect(convex.mutation).toHaveBeenCalledTimes(2);
    const [ref, args] = convex.mutation.mock.calls[1]!;
    expect(getFunctionName(ref)).toBe("conversations:appendEntry");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      conversationId: "s1",
      entry: {
        kind: "message",
        role: "user",
        content: "hello",
      },
    });
  });

  it("promotes an existing direct conversation to the live runtime", async () => {
    convex.query.mockResolvedValue({
      conversation: {
        runtime: { kind: "direct", modelId: "kody-live-fly" },
      },
    });

    await writeSessionMeta(makeOctokit(), "acme", "widgets", "s1", META);

    expect(convex.mutation).toHaveBeenCalledTimes(1);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("conversations:updateRuntime");
    expect(args).toMatchObject({
      tenantId: "acme/widgets",
      conversationId: "s1",
      runtime: { kind: "live", profileId: "kody-live" },
    });
  });

  it("fails closed when Convex is down", async () => {
    convex.query.mockResolvedValue(null);
    convex.mutation.mockRejectedValue(new Error("convex down"));

    await expect(
      writeSessionMeta(makeOctokit(), "acme", "widgets", "s1", META),
    ).rejects.toThrow("convex down");
  });
});

describe("appendUserTurn convex record", () => {
  it("appends the turn to the canonical timeline", async () => {
    convex.query
      .mockResolvedValueOnce({
        conversation: { activeAgent: { slug: "kody", title: "Kody" } },
      })
      .mockResolvedValueOnce({
        entries: [{ entry: { kind: "message" } }],
      });
    const result = await appendUserTurn(
      makeOctokit(),
      "acme",
      "widgets",
      "s1",
      TURN,
    );

    expect(result.turnCount).toBe(1);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("conversations:appendEntry");
    expect(args.entry).toMatchObject({
      kind: "message",
      role: "user",
      content: "hello",
    });
  });
});

describe("readSessionTranscript", () => {
  it("returns meta plus turns ordered by seq", async () => {
    convex.query.mockResolvedValue({
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

    const result = await readSessionTranscript("acme", "widgets", "s1");

    const [ref, args] = convex.query.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("conversations:get");
    expect(args).toEqual({
      tenantId: "acme/widgets",
      conversationId: "s1",
    });
    expect(result?.meta.mode).toBe("interactive");
    expect(result?.turns.map((t) => t.content)).toEqual(["hello", "second"]);
  });

  it("returns null for unknown sessions", async () => {
    convex.query.mockResolvedValue(null);
    expect(await readSessionTranscript("acme", "widgets", "nope")).toBeNull();
  });
});
