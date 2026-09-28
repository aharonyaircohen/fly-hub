import crypto from "node:crypto";

const TOKEN_PREFIX = "kody_mcp_";

export function generateMcpAccessToken(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashMcpAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function isMcpAccessToken(token: string): boolean {
  return (
    token.startsWith(TOKEN_PREFIX) &&
    token.length >= TOKEN_PREFIX.length + 40 &&
    token.length <= TOKEN_PREFIX.length + 64
  );
}
