import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../packages/kody-chat-dashboard/src/dashboard/lib/kody-chat-live-session",
  () => ({
    authHeaders: () => ({ Authorization: "Bearer test" }),
  }),
);

import {
  deleteAttachment,
  getAttachment,
  persistPendingAttachment,
  putAttachment,
} from "@dashboard/lib/attachment-store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("attachment store", () => {
  it("keeps composer-only files pending until a conversation exists", async () => {
    const ref = await putAttachment({
      name: "note.txt",
      mimeType: "text/plain",
      size: 5,
      blob: new Blob(["hello"], { type: "text/plain" }),
    });

    expect(ref.id).toMatch(/^pending-/);
    expect((await getAttachment(ref.id))?.name).toBe("note.txt");
  });

  it("uploads pending data and returns a durable conversation attachment id", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "att-1",
          name: "note.txt",
          mimeType: "text/plain",
          size: 5,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const pending = await putAttachment({
      name: "note.txt",
      mimeType: "text/plain",
      size: 5,
      blob: new Blob(["hello"], { type: "text/plain" }),
    });

    const stored = await persistPendingAttachment("conversation-1", pending);

    expect(stored.id).toBe("conversation-1::att-1");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/kody/chat/conversations/conversation-1/attachments",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("actorLogin")).toBe(false);
    expect(await getAttachment(pending.id)).toBeNull();
  });

  it("loads and deletes durable attachments through authenticated APIs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["hello"], { type: "text/plain" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const record = await getAttachment("conversation-1::att-1");
    await deleteAttachment("conversation-1::att-1");

    expect(await record?.blob.text()).toBe("hello");
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/kody/chat/conversations/conversation-1/attachments/att-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
