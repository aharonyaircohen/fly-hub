export type BrowserStreamMessage =
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      deltaX?: number;
      deltaY?: number;
      button?: "left" | "middle" | "right";
    }
  | {
      type: "keyboard";
      action: "down" | "up" | "insertText";
      key: string;
    }
  | { type: "zoom"; delta: -1 | 0 | 1 }
  | { type: "viewport"; width: number; height: number }
  | { type: "frameAck"; frameId: number }
  | { type: "requestState" };

export type BrowserStreamAction = Exclude<
  BrowserStreamMessage,
  { type: "frameAck" | "requestState" }
> | null;

const BROWSER_FRAME_MAGIC = new TextEncoder().encode("KBF1");

/** Compact wire packet: four-byte magic, uint32 frame id, then raw JPEG. */
export function encodeBrowserFrame(
  frameId: number,
  jpeg: Uint8Array,
): Uint8Array {
  if (!Number.isSafeInteger(frameId) || frameId < 0 || frameId > 0xffff_ffff) {
    invalid();
  }
  const packet = new Uint8Array(8 + jpeg.byteLength);
  packet.set(BROWSER_FRAME_MAGIC, 0);
  new DataView(packet.buffer).setUint32(4, frameId);
  packet.set(jpeg, 8);
  return packet;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(): never {
  throw new Error("browser_stream_message_invalid");
}

export function parseBrowserStreamMessage(raw: string): BrowserStreamMessage {
  if (raw.length > 16 * 1024) invalid();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (!value || typeof value !== "object") invalid();
  const input = value as Record<string, unknown>;
  if (input.type === "requestState") return { type: "requestState" };
  if (input.type === "frameAck") {
    if (!Number.isSafeInteger(input.frameId) || Number(input.frameId) < 0)
      invalid();
    return { type: "frameAck", frameId: Number(input.frameId) };
  }
  if (input.type === "viewport") {
    if (
      !Number.isInteger(input.width) ||
      !Number.isInteger(input.height) ||
      Number(input.width) < 320 ||
      Number(input.width) > 1_920 ||
      Number(input.height) < 480 ||
      Number(input.height) > 1_800
    )
      invalid();
    return {
      type: "viewport",
      width: Number(input.width),
      height: Number(input.height),
    };
  }
  if (input.type === "keyboard") {
    if (
      !["down", "up", "insertText"].includes(String(input.action)) ||
      typeof input.key !== "string" ||
      input.key.length > 4_096
    )
      invalid();
    return {
      type: "keyboard",
      action: input.action as "down" | "up" | "insertText",
      key: input.key,
    };
  }
  if (input.type === "zoom") {
    if (![-1, 0, 1].includes(Number(input.delta))) invalid();
    return { type: "zoom", delta: Number(input.delta) as -1 | 0 | 1 };
  }
  if (input.type === "pointer") {
    if (
      !["move", "down", "up", "wheel"].includes(String(input.action)) ||
      !finiteNumber(input.x) ||
      !finiteNumber(input.y) ||
      (input.deltaX !== undefined && !finiteNumber(input.deltaX)) ||
      (input.deltaY !== undefined && !finiteNumber(input.deltaY)) ||
      (input.button !== undefined &&
        !["left", "middle", "right"].includes(String(input.button)))
    )
      invalid();
    return {
      type: "pointer",
      action: input.action as "move" | "down" | "up" | "wheel",
      x: input.x,
      y: input.y,
      ...(input.deltaX !== undefined ? { deltaX: input.deltaX } : {}),
      ...(input.deltaY !== undefined ? { deltaY: input.deltaY } : {}),
      ...(input.button !== undefined
        ? { button: input.button as "left" | "middle" | "right" }
        : {}),
    };
  }
  return invalid();
}

export function browserActionForStreamMessage(
  message: BrowserStreamMessage,
): BrowserStreamAction {
  if (message.type === "frameAck" || message.type === "requestState")
    return null;
  return message;
}
