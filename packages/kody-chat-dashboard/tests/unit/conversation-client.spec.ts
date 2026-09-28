import { describe, expect, it, vi } from "vitest";
import {
  ConversationClient,
  createConversationClient,
} from "../../src/dashboard/lib/chat/core/conversation/conversation-client";

describe("ConversationClient Hermes adapter", () => {
  it("loads Hermes sessions with browser fetch and client headers", async () => {
    const original = globalThis.fetch;
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ sessions: [{
        id: "saved-1", title: "Saved chat", message_count: 2,
      }] }));
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const client = new ConversationClient();
      await expect(client.list()).resolves.toMatchObject([{ conversationId: "saved-1", title: "Saved chat" }]);
      expect(fetcher).toHaveBeenCalledWith(
        "/api/kody/hermes/sessions?limit=100&source=kody-global",
        expect.objectContaining({ cache: "no-store" }),
      );
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });

  it("maps a new local draft to Hermes ids before deleting it", async () => {
    let finishCreate: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      if (String(input) === "/api/kody/hermes/sessions" && init?.method === "POST") {
        return new Promise<Response>((resolve) => { finishCreate = resolve; });
      }
      if (String(input) === "/api/kody/hermes/sessions/saved-1" && init?.method === "DELETE") {
        return Promise.resolve(Response.json({ ok: true }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const client = createConversationClient({ "x-kody-surface-ticket": "signed-ticket" }, fetcher);
    const creation = client.create({ conversationId: "draft-1", title: "New conversation" });
    const deletion = client.remove("draft-1");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    finishCreate?.(Response.json({ session_id: "active-1", stored_session_id: "saved-1" }));
    await creation;
    await deletion;
    expect(fetcher).toHaveBeenNthCalledWith(2,
      "/api/kody/hermes/sessions/saved-1",
      expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({
        "x-kody-surface-ticket": "signed-ticket",
      }) }),
    );
  });

  it("keeps tool progress in the UI while Hermes persists chat turns", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new ConversationClient(fetcher);
    await client.command("saved-1", {
      kind: "append-message", actorLogin: "alice", entryId: "tool-1",
      idempotencyKey: "tool-1", role: "assistant", content: "working",
      status: "pending", turnId: "turn-1", createdAt: new Date().toISOString(),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("waits for a cleared session's replacement before the next turn", async () => {
    let finishReplacement: ((response: Response) => void) | undefined;
    let creates = 0;
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      if (String(input) === "/api/kody/hermes/sessions" && init?.method === "POST") {
        creates += 1;
        return creates === 1
          ? Promise.resolve(Response.json({ session_id: "active-1", stored_session_id: "saved-1" }))
          : new Promise<Response>((resolve) => { finishReplacement = resolve; });
      }
      if (String(input) === "/api/kody/hermes/sessions/saved-1" && init?.method === "DELETE") {
        return Promise.resolve(Response.json({ ok: true }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const client = new ConversationClient(fetcher);
    await client.create({ conversationId: "draft-1" });
    const cleared = client.command("draft-1", { kind: "clear", actorLogin: "alice" });
    const nextId = client.resolveSessionId("draft-1");
    await vi.waitFor(() => expect(creates).toBe(2));
    finishReplacement?.(Response.json({ session_id: "active-2", stored_session_id: "saved-2" }));
    await cleared;
    await expect(nextId).resolves.toBe("saved-2");
  });

  it("surfaces Hermes request errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ message: "Hermes unavailable" }, { status: 503 }),
    );
    const client = new ConversationClient(fetcher);
    await expect(client.remove("saved-1")).rejects.toThrow("Hermes unavailable");
  });
});
