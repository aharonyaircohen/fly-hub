import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  browserActionForStreamMessage,
  encodeBrowserFrame,
  parseBrowserStreamMessage,
} from "../../src/browsers/stream-protocol";

describe("browser stream protocol", () => {
  it("encodes rendered frames without JSON or base64 overhead", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const encoded = encodeBrowserFrame(42, jpeg);

    expect(new TextDecoder().decode(encoded.slice(0, 4))).toBe("KBF1");
    expect(new DataView(encoded.buffer).getUint32(4)).toBe(42);
    expect(encoded.slice(8)).toEqual(jpeg);
  });

  it("keeps the page stream and adds an authenticated direct desktop", () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const startScript = readFileSync(`${packageRoot}/browser/start.sh`, "utf8");
    const dockerfile = readFileSync(
      `${packageRoot}/browser/Dockerfile`,
      "utf8",
    );
    const server = readFileSync(`${packageRoot}/browser/server.ts`, "utf8");
    const smokeTest = readFileSync(
      `${packageRoot}/browser/smoke-test.mjs`,
      "utf8",
    );
    const browserPackage = JSON.parse(
      readFileSync(`${packageRoot}/browser/package.json`, "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(startScript).not.toContain("--headless=new");
    expect(startScript).toMatch(/Xvfb|fluxbox|x11vnc/);
    expect(startScript).toContain("rm -f /tmp/.X99-lock /tmp/.X11-unix/X99");
    expect(startScript).toContain("/tmp/.X11-unix/X99");
    expect(startScript).toContain('-display "$DISPLAY"');
    expect(startScript).not.toContain("WAIT${DISPLAY}");
    expect(startScript).toContain("-screen 0 1440x900x24");
    expect(startScript).toContain("--window-size=1440,900");
    expect(startScript).toContain("--window-position=0,0");
    expect(dockerfile).toMatch(/\bfeh\b/);
    expect(dockerfile).toMatch(/novnc|x11vnc|xvfb/);
    expect(dockerfile).toContain("/tmp/.X11-unix");
    expect(dockerfile).toContain("chmod 1777 /tmp/.X11-unix");
    expect(browserPackage.dependencies?.["@novnc/novnc"]).toBe("1.7.0");
    expect(server).toContain("Page.startScreencast");
    expect(server).toContain("quality: 72");
    expect(server).toContain("createLatestFrameBuffer<Uint8Array>()");
    expect(server).toContain("frameBuffer.acknowledge()");
    expect(server).toContain("const heartbeat = setInterval");
    expect(server).toContain("websocket.ping()");
    expect(smokeTest).toContain('packet.toString("ascii", 0, 4) !== "KBF1"');
    expect(server).toContain("clearInterval(heartbeat)");
    expect(server).toContain('requestUrl.pathname === "/direct"');
    expect(server).toContain('pathname === "/direct/client.js"');
    expect(server).toContain("img-src 'self' data:");
    expect(server).toContain("rfb.resizeSession = false");
    expect(server).toContain("const DIRECT_PAGE_VIEWPORT");
    expect(server).toContain("async function waitForVnc");
    expect(server).toContain("await waitForVnc()");
    expect(server).toContain('data.toString("ascii", 0, 4) === "RFB "');
    expect(server).toContain("directClientCount");
    expect(server).toContain('status.textContent = "Reconnecting browser…"');
    expect(server).toContain("setTimeout(connect, 1_000)");
    expect(server).toContain("if (activeRfb) return");
    expect(server).toContain("if (activeRfb !== rfb) return");
    expect(smokeTest).toContain("fetch(`${endpoint}/direct/client.js`");
    expect(smokeTest).toContain("fetch(`${endpoint}/direct/core/rfb.js`");
    expect(server).toContain('url.pathname === "/direct-stream"');
    expect(server).toContain('net.connect({ host: "127.0.0.1", port: 5900 })');
    expect(server).not.toContain("net.connect(5900");
    expect(server).toContain(
      '"fly-replay": `instance=${authorization.machineId}`',
    );
  });

  it("maps pointer input without dropping wheel details", () => {
    const parsed = parseBrowserStreamMessage(
      JSON.stringify({
        type: "pointer",
        action: "wheel",
        x: 320,
        y: 240,
        deltaX: 4,
        deltaY: 180,
      }),
    );

    expect(browserActionForStreamMessage(parsed)).toEqual({
      type: "pointer",
      action: "wheel",
      x: 320,
      y: 240,
      deltaX: 4,
      deltaY: 180,
    });
  });

  it("accepts keyboard, viewport, state, and frame acknowledgement messages", () => {
    expect(
      parseBrowserStreamMessage(
        JSON.stringify({ type: "keyboard", action: "down", key: "Enter" }),
      ),
    ).toEqual({ type: "keyboard", action: "down", key: "Enter" });
    expect(
      parseBrowserStreamMessage(JSON.stringify({ type: "zoom", delta: 1 })),
    ).toEqual({ type: "zoom", delta: 1 });
    expect(
      parseBrowserStreamMessage(
        JSON.stringify({ type: "viewport", width: 1600, height: 1500 }),
      ),
    ).toEqual({ type: "viewport", width: 1600, height: 1500 });
    expect(parseBrowserStreamMessage('{"type":"requestState"}')).toEqual({
      type: "requestState",
    });
    expect(
      parseBrowserStreamMessage(
        JSON.stringify({ type: "frameAck", frameId: 42 }),
      ),
    ).toEqual({ type: "frameAck", frameId: 42 });
  });

  it("rejects malformed, oversized, and unsupported input", () => {
    expect(() => parseBrowserStreamMessage("not-json")).toThrow(
      "browser_stream_message_invalid",
    );
    expect(() =>
      parseBrowserStreamMessage(
        JSON.stringify({ type: "viewport", width: 10, height: 10 }),
      ),
    ).toThrow("browser_stream_message_invalid");
    expect(() =>
      parseBrowserStreamMessage(
        JSON.stringify({
          type: "keyboard",
          action: "down",
          key: "x".repeat(5_000),
        }),
      ),
    ).toThrow("browser_stream_message_invalid");
    expect(() => parseBrowserStreamMessage('{"type":"unknown"}')).toThrow(
      "browser_stream_message_invalid",
    );
    expect(() =>
      parseBrowserStreamMessage('{"type":"zoom","delta":2}'),
    ).toThrow("browser_stream_message_invalid");
  });
});
