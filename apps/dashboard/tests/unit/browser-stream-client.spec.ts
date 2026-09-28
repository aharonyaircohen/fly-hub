import { describe, expect, it } from "vitest";

import {
  browserPointerCoordinates,
  keyboardStreamMessages,
  parseBrowserBinaryFrame,
  parseBrowserStreamServerMessage,
} from "@dashboard/lib/previews/browser-stream-client";

describe("browser stream client protocol", () => {
  it("parses compact binary JPEG frames", () => {
    const encoded = new Uint8Array(12);
    encoded.set(new TextEncoder().encode("KBF1"));
    new DataView(encoded.buffer).setUint32(4, 42);
    encoded.set([0xff, 0xd8, 0xff, 0xd9], 8);

    expect(parseBrowserBinaryFrame(encoded.buffer)).toEqual({
      type: "frame",
      frameId: 42,
      data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    });
  });

  it("rejects malformed binary frames", () => {
    expect(() => parseBrowserBinaryFrame(new ArrayBuffer(8))).toThrow(
      "browser_stream_response_invalid",
    );
    expect(() =>
      parseBrowserBinaryFrame(new TextEncoder().encode("NOPEpayload").buffer),
    ).toThrow("browser_stream_response_invalid");
  });

  it("parses authoritative page state and rendered frames", () => {
    expect(
      parseBrowserStreamServerMessage(
        JSON.stringify({
          type: "state",
          page: {
            url: "https://example.com/docs",
            title: "Docs",
            loading: false,
            canGoBack: true,
            canGoForward: false,
            revision: 3,
            viewport: { width: 1280, height: 720 },
          },
        }),
      ),
    ).toMatchObject({ type: "state", page: { revision: 3 } });
    expect(
      parseBrowserStreamServerMessage(
        JSON.stringify({
          type: "frame",
          frameId: 7,
          data: "jpeg-base64",
          metadata: { deviceWidth: 1280, deviceHeight: 720 },
        }),
      ),
    ).toMatchObject({ type: "frame", frameId: 7 });
  });

  it("maps scaled canvas input to the Chromium viewport", () => {
    expect(
      browserPointerCoordinates(
        { left: 10, top: 20, width: 640, height: 360 },
        { width: 1280, height: 720 },
        330,
        200,
      ),
    ).toEqual({ x: 640, y: 360 });
  });

  it("inserts printable Hebrew text without keyboard-layout translation", () => {
    expect(
      keyboardStreamMessages(
        { key: "ש", ctrlKey: false, metaKey: false, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "keyboard", action: "insertText", key: "ש" }]);
    expect(
      keyboardStreamMessages(
        { key: "Enter", ctrlKey: false, metaKey: false, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "keyboard", action: "down", key: "Enter" }]);
    expect(
      keyboardStreamMessages(
        { key: "Enter", ctrlKey: false, metaKey: false, altKey: false },
        "up",
      ),
    ).toEqual([{ type: "keyboard", action: "up", key: "Enter" }]);
  });

  it("maps macOS Command shortcuts to the remote Linux Control key", () => {
    expect(
      keyboardStreamMessages(
        { key: "Meta", ctrlKey: false, metaKey: true, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "keyboard", action: "down", key: "Control" }]);
    expect(
      keyboardStreamMessages(
        { key: "a", ctrlKey: false, metaKey: true, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "keyboard", action: "down", key: "a" }]);
    expect(
      keyboardStreamMessages(
        { key: "Meta", ctrlKey: false, metaKey: false, altKey: false },
        "up",
      ),
    ).toEqual([{ type: "keyboard", action: "up", key: "Control" }]);
    expect(
      keyboardStreamMessages(
        { key: "+", ctrlKey: false, metaKey: true, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "zoom", delta: 1 }]);
    expect(
      keyboardStreamMessages(
        { key: "-", ctrlKey: true, metaKey: false, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "zoom", delta: -1 }]);
    expect(
      keyboardStreamMessages(
        { key: "0", ctrlKey: true, metaKey: false, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "zoom", delta: 0 }]);
    expect(
      keyboardStreamMessages(
        { key: "+", ctrlKey: false, metaKey: true, altKey: false },
        "up",
      ),
    ).toEqual([]);
    expect(
      keyboardStreamMessages(
        { key: "Control", ctrlKey: true, metaKey: false, altKey: false },
        "down",
      ),
    ).toEqual([{ type: "keyboard", action: "down", key: "Control" }]);
  });

  it("rejects malformed remote messages", () => {
    expect(() => parseBrowserStreamServerMessage("not-json")).toThrow(
      "browser_stream_response_invalid",
    );
    expect(() =>
      parseBrowserStreamServerMessage('{"type":"frame","frameId":-1}'),
    ).toThrow("browser_stream_response_invalid");
  });
});
