import { createHmac, timingSafeEqual } from "node:crypto";

export function encodeMemoryCursor(
  state: { binding: string; index: number; cursor: string | null },
  key: string,
): string {
  if (!key) throw new Error("Memory cursor signing key is unavailable");
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
}

export function decodeMemoryCursor(
  value: string,
  binding: string,
  key: string,
) {
  if (!key) throw new Error("Memory cursor signing key is unavailable");
  const [data, signature, extra] = value.split(".");
  const expected = createHmac("sha256", key)
    .update(data ?? "")
    .digest();
  const supplied = Buffer.from(signature ?? "", "base64url");
  if (
    extra ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error("Invalid memory cursor");
  const state = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (
    state.binding !== binding ||
    !Number.isInteger(state.index) ||
    state.index < 0 ||
    (state.cursor !== null && typeof state.cursor !== "string")
  )
    throw new Error("Invalid memory cursor");
  return state as { binding: string; index: number; cursor: string | null };
}
