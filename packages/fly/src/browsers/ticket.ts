import crypto from "node:crypto";

const BROWSER_KEY_INFO = "kody-browser:v1";
const HMAC_BYTES = 16;

export interface BrowserTicketIdentity {
  repository: string;
  actorId: string;
  sessionId: string;
  machineId: string;
}

interface BrowserTicketPayload extends BrowserTicketIdentity {
  expiresAt: number;
  signature: string;
}

export function deriveBrowserKey(
  masterRaw = process.env.KODY_MASTER_KEY,
): Buffer {
  const raw = masterRaw?.trim();
  if (!raw) throw new Error("KODY_MASTER_KEY is not configured");
  const master = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return Buffer.from(
    crypto.hkdfSync("sha256", master, Buffer.alloc(0), BROWSER_KEY_INFO, 32),
  );
}

function subject(identity: BrowserTicketIdentity, expiresAt: number): string {
  return [
    identity.repository,
    identity.actorId,
    identity.sessionId,
    identity.machineId,
    expiresAt,
  ].join("\n");
}

export function mintBrowserTicket(
  identity: BrowserTicketIdentity,
  ttlSeconds: number,
  key = deriveBrowserKey(),
  nowSeconds = Math.floor(Date.now() / 1000),
): { ticket: string; expiresAt: number } {
  const expiresAt = nowSeconds + ttlSeconds;
  const signature = crypto
    .createHmac("sha256", key)
    .update(subject(identity, expiresAt))
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);
  return {
    ticket: Buffer.from(
      JSON.stringify({ ...identity, expiresAt, signature }),
    ).toString("base64url"),
    expiresAt,
  };
}

function decodeBrowserTicket(ticket: string): BrowserTicketPayload | null {
  try {
    const value = JSON.parse(
      Buffer.from(ticket, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof value.repository !== "string" ||
      typeof value.actorId !== "string" ||
      typeof value.sessionId !== "string" ||
      typeof value.machineId !== "string" ||
      typeof value.expiresAt !== "number" ||
      typeof value.signature !== "string"
    ) {
      return null;
    }
    return value as unknown as BrowserTicketPayload;
  } catch {
    return null;
  }
}

export function readBrowserTicket(
  ticket: string,
  key: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): BrowserTicketPayload | null {
  const payload = decodeBrowserTicket(ticket);
  if (!payload || payload.expiresAt <= nowSeconds) return null;
  const expectedSignature = crypto
    .createHmac("sha256", key)
    .update(subject(payload, payload.expiresAt))
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);
  const actualBuffer = Buffer.from(payload.signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer) ? payload : null;
}

export function verifyBrowserTicket(
  ticket: string,
  expected: BrowserTicketIdentity,
  key: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const payload = readBrowserTicket(ticket, key, nowSeconds);
  if (!payload) return false;
  if (
    payload.repository !== expected.repository ||
    payload.actorId !== expected.actorId ||
    payload.sessionId !== expected.sessionId ||
    payload.machineId !== expected.machineId
  ) {
    return false;
  }
  return true;
}
