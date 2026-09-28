import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "../../../src/dashboard/lib/chat/plugins/terminal/terminal-http";
import {
  openTerminalWebLink,
  usefulCapturedOutput,
} from "../../../src/dashboard/lib/chat/plugins/terminal/terminal-text";
import { resetTerminalUiForRestart } from "../../../src/dashboard/lib/chat/plugins/terminal/xterm-setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal surface boundaries", () => {
  it("bounds local terminal requests", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });

    const pending = fetchWithTimeout("/terminal", {}, 5_000);
    const assertion = expect(pending).rejects.toThrow("Aborted");
    vi.advanceTimersByTime(5_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it("resets interactive modes without clearing scrollback", () => {
    const calls: string[] = [];
    resetTerminalUiForRestart({
      write: (data) => void calls.push(data),
      focus: () => void calls.push("focus"),
    });
    expect(calls[0]).toContain("\u001b[?1049l");
    expect(calls).not.toContain("clear");
    expect(calls.at(-1)).toBe("focus");
  });

  it("keeps web links safe and captured output useful", () => {
    const opened = { opener: {} as unknown };
    const openWindow = vi.fn(() => opened as Window & { opener: unknown });
    openTerminalWebLink("https://example.com", openWindow);
    expect(openWindow).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(opened.opener).toBeNull();
    expect(
      usefulCapturedOutput("\u001b[31mred\u001b[0m\r\n\r\nline two\r\n"),
    ).toBe("red\nline two");
  });
});
