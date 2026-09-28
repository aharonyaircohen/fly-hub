/**
 * Byte-safe conversions shared by repository transport and browser previews.
 * This module has no GitHub or React concerns.
 */

/** Decode a base64 string to a UTF-8 string without latin1 corruption. */
export function base64ToString(base64: string): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    base64ToBytes(base64),
  );
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function isBinaryBytes(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/** Encode a string to base64 using UTF-8, without btoa's latin1 restriction. */
export function stringToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/** Byte-safe base64 encoder that handles all uint8 values 0-255. */
export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    result +=
      alphabet[(first >> 2) & 0x3f] +
      alphabet[((first << 4) | (second >> 4)) & 0x3f] +
      alphabet[((second << 2) | (third >> 6)) & 0x3f] +
      alphabet[third & 0x3f];
  }

  const remainder = bytes.length % 3;
  if (remainder === 1) return `${result.slice(0, -2)}==`;
  if (remainder === 2) return `${result.slice(0, -1)}=`;
  return result;
}
