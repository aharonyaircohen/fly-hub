import { describe, expect, it, vi } from "vitest";

import {
  browserUploadEndpoint,
  resumeBrowserSession,
  stageBrowserUpload,
} from "@dashboard/lib/previews/browser-session-client";

describe("Fly browser repository upload", () => {
  it("renews an existing browser through resume without supplying a URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mode: "remote",
          sessionId: "browser-fixed",
          state: "running",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await resumeBrowserSession("octocat", "browser-fixed");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kody/browser/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operation: "resume",
          actorLogin: "octocat",
          sessionId: "browser-fixed",
        }),
      }),
    );
    fetchMock.mockRestore();
  });

  it("converts the authenticated stream URL into the direct upload endpoint", () => {
    expect(
      browserUploadEndpoint(
        "wss://kody-browser.fly.dev/stream?ticket=signed-ticket",
      ),
    ).toBe("https://kody-browser.fly.dev/upload?ticket=signed-ticket");
  });

  it("stages ordered media directly in Fly without sending bytes through Vercel", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );

    await expect(
      stageBrowserUpload({
        uploadUrl: "https://kody-browser.fly.dev/upload?ticket=signed-ticket",
        uploadId: "123e4567-e89b-42d3-a456-426614174000",
        files: [
          {
            name: "01-cover.jpg",
            mimeType: "image/jpeg",
            bytes: new Uint8Array([1, 2, 3]),
          },
          {
            name: "02-demo.mp4",
            mimeType: "video/mp4",
            bytes: new Uint8Array([4, 5]),
          },
        ],
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toContain(
      "uploadId=123e4567-e89b-42d3-a456-426614174000&index=0&name=01-cover.jpg&mimeType=image%2Fjpeg",
    );
    expect(fetchImpl.mock.calls[1]![0]).toContain("index=1&name=02-demo.mp4");
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe("POST");
    expect(
      new Uint8Array(fetchImpl.mock.calls[0]![1]?.body as ArrayBuffer),
    ).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects unsupported media before transmission", async () => {
    await expect(
      stageBrowserUpload({
        uploadUrl: "https://kody-browser.fly.dev/upload?ticket=x",
        uploadId: "123e4567-e89b-42d3-a456-426614174000",
        files: [
          {
            name: "secret.txt",
            mimeType: "text/plain",
            bytes: new Uint8Array([1]),
          },
        ],
      }),
    ).rejects.toThrow("browser_upload_type_not_allowed");
  });
});
