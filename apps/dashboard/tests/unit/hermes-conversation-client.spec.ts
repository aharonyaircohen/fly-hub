import { describe, expect, it, vi } from "vitest";
import { ConversationClient } from "../../../../packages/kody-chat-dashboard/src/dashboard/lib/chat/core/conversation/conversation-client";
import { hermesChatModels } from "../../../../packages/kody-chat-dashboard/src/dashboard/lib/components/kody-chat-data";

describe("Hermes conversation adapter", () => {
  it("uses Hermes model options in the existing picker", () => {
    expect(hermesChatModels({
      provider: "minimax",
      model: "MiniMax-M3",
      providers: [
        { slug: "minimax", name: "MiniMax", models: ["MiniMax-M3"] },
        { slug: "moa", name: "Mixture", models: ["default"] },
      ],
    })).toEqual([{
      id: "minimax/MiniMax-M3",
      label: "MiniMax · MiniMax-M3",
      enabled: true,
      default: true,
    }]);
  });

  it("maps a local draft to Hermes ids and reads saved history", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kody/hermes/sessions" && init?.method === "POST") {
        return Response.json({ session_id: "runtime-1", stored_session_id: "stored-1" }, { status: 201 });
      }
      if (url === "/api/kody/hermes/sessions/stored-1" && !init?.method) {
        return Response.json({
          session: { id: "stored-1", title: "Saved chat", message_count: 2 },
          history: { messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
          ] },
        });
      }
      if (url === "/api/kody/hermes/sessions/stored-1" && init?.method === "DELETE") {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const client = new ConversationClient(fetcher);
    await client.create({ conversationId: "draft-1", title: "New conversation" });
    await expect(client.resolveSessionId("draft-1")).resolves.toBe("stored-1");
    await expect(client.resolveRuntimeSessionId("draft-1")).resolves.toBe("runtime-1");
    const detail = await client.get("draft-1") as {
      conversation: { conversationId: string };
      entries: Array<{ entry: { content: string } }>;
    };
    expect(detail.conversation.conversationId).toBe("draft-1");
    expect(detail.entries.map((entry) => entry.entry.content)).toEqual(["Hello", "Hi"]);
    await client.remove("draft-1");
    expect(fetcher).toHaveBeenCalledWith("/api/kody/hermes/sessions/stored-1", expect.objectContaining({ method: "DELETE" }));
  });
});
