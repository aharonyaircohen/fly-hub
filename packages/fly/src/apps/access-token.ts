import crypto from "node:crypto";

export function generateAppAccessToken(): string {
  return `kody_app_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashAppAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyAppAccessToken(
  token: string,
  expectedHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashAppAccessToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
