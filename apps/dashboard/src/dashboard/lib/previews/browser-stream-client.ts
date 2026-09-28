import type { BrowserPageState } from "./browser-controller-state";

export type BrowserStreamServerMessage =
  | { type: "ready" }
  | { type: "state"; page: BrowserPageState & { viewport: BrowserViewport } }
  | {
      type: "frame";
      frameId: number;
      data: string;
      metadata: Record<string, unknown>;
    }
  | { type: "error"; error: string };

export interface BrowserViewport {
  width: number;
  height: number;
}

export type BrowserBinaryFrame = {
  type: "frame";
  frameId: number;
  data: Uint8Array;
};

export function parseBrowserBinaryFrame(raw: ArrayBuffer): BrowserBinaryFrame {
  const bytes = new Uint8Array(raw);
  if (
    bytes.byteLength <= 8 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== "KBF1"
  ) {
    return invalid();
  }
  const frameId = new DataView(raw).getUint32(4);
  return { type: "frame", frameId, data: bytes.slice(8) };
}

export type BrowserKeyboardMessage =
  | {
      type: "keyboard";
      action: "down" | "up" | "insertText";
      key: string;
    }
  | { type: "zoom"; delta: -1 | 0 | 1 };

function invalid(): never {
  throw new Error("browser_stream_response_invalid");
}

function validPageState(value: unknown): value is BrowserPageState & {
  viewport: BrowserViewport;
} {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  const viewport = page.viewport as Record<string, unknown> | undefined;
  return (
    typeof page.url === "string" &&
    typeof page.title === "string" &&
    typeof page.loading === "boolean" &&
    typeof page.canGoBack === "boolean" &&
    typeof page.canGoForward === "boolean" &&
    Number.isSafeInteger(page.revision) &&
    !!viewport &&
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height)
  );
}

export function parseBrowserStreamServerMessage(
  raw: string,
): BrowserStreamServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (!value || typeof value !== "object") invalid();
  const message = value as Record<string, unknown>;
  if (message.type === "ready") return { type: "ready" };
  if (message.type === "error" && typeof message.error === "string") {
    return { type: "error", error: message.error };
  }
  if (message.type === "state" && validPageState(message.page)) {
    return { type: "state", page: message.page };
  }
  if (
    message.type === "frame" &&
    Number.isSafeInteger(message.frameId) &&
    Number(message.frameId) >= 0 &&
    typeof message.data === "string" &&
    message.data.length > 0 &&
    !!message.metadata &&
    typeof message.metadata === "object"
  ) {
    return {
      type: "frame",
      frameId: Number(message.frameId),
      data: message.data,
      metadata: message.metadata as Record<string, unknown>,
    };
  }
  return invalid();
}

export function browserPointerCoordinates(
  rect: { left: number; top: number; width: number; height: number },
  viewport: BrowserViewport,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const normalizedX = rect.width ? (clientX - rect.left) / rect.width : 0;
  const normalizedY = rect.height ? (clientY - rect.top) / rect.height : 0;
  return {
    x: Math.max(0, Math.min(viewport.width, normalizedX * viewport.width)),
    y: Math.max(0, Math.min(viewport.height, normalizedY * viewport.height)),
  };
}

export function keyboardStreamMessages(
  input: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  },
  phase: "down" | "up",
): BrowserKeyboardMessage[] {
  // The remote browser runs on Linux, where page shortcuts use Control.
  // Preserve the user's platform convention by translating macOS Command.
  const key = input.key === "Meta" ? "Control" : input.key;
  const shortcutModifier = input.ctrlKey || input.metaKey;
  const zoomDelta = ["+", "="].includes(key)
    ? 1
    : key === "-"
      ? -1
      : key === "0"
        ? 0
        : null;
  if (shortcutModifier && zoomDelta !== null) {
    return phase === "down" ? [{ type: "zoom", delta: zoomDelta }] : [];
  }
  if (
    key.length === 1 &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.altKey &&
    phase === "down"
  ) {
    return [{ type: "keyboard", action: "insertText", key }];
  }
  if (
    phase === "up" &&
    key.length === 1 &&
    !input.ctrlKey &&
    !input.metaKey &&
    !input.altKey
  ) {
    return [];
  }
  return [{ type: "keyboard", action: phase, key }];
}
