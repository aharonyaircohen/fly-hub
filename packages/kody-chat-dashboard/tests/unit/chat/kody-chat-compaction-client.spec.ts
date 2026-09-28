import { describe, expect, it, vi } from "vitest";
import { compactConversationForTurn } from "../../../src/dashboard/lib/components/kody-chat-compaction";

const messages = Array.from({ length: 8 }, (_, index) => ({
  role: (index % 2 ? "assistant" : "user") as "user" | "assistant",
  content: `${index}:${"x".repeat(80)}`,
}));

describe("compactConversationForTurn", () => {
  it("shows progress, persists the checkpoint, and returns compact context", async () => {
    const onStatus = vi.fn();
    const onCheckpoint = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ summary: "Goal: keep working." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await compactConversationForTurn({
      messages,
      nextUserContent: "continue",
      triggerTokens: 100,
      recentTokens: 50,
      headers: { "x-kody-token": "token" },
      model: "model-id",
      fetchImpl,
      onStatus,
      onCheckpoint,
    });

    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "compacting",
      "compacted",
    ]);
    expect(onCheckpoint).toHaveBeenCalledWith(result.context.checkpoint);
    expect(result.didCompact).toBe(true);
    expect(result.context.summary).toBe("Goal: keep working.");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/kody/chat/compact",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("continues with the current context when compaction fails", async () => {
    const onStatus = vi.fn();
    const onCheckpoint = vi.fn();

    const result = await compactConversationForTurn({
      messages,
      nextUserContent: "continue",
      triggerTokens: 100,
      recentTokens: 50,
      fetchImpl: vi.fn(async () => new Response("bad", { status: 502 })),
      onStatus,
      onCheckpoint,
    });

    expect(result.didCompact).toBe(false);
    expect(result.context.summary).toBeNull();
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "compacting",
      null,
    ]);
  });

  it("allows the composer action to force compaction below the auto threshold", async () => {
    const onCheckpoint = vi.fn();
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ summary: "Manual compact memory." }), {
          status: 200,
        }),
    );

    const result = await compactConversationForTurn({
      messages: messages.slice(0, 4),
      nextUserContent: "",
      force: true,
      recentTokens: 0,
      fetchImpl,
      onStatus: vi.fn(),
      onCheckpoint,
    });

    expect(result.didCompact).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onCheckpoint).toHaveBeenCalledOnce();
  });
});
