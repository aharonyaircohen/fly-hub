/**
 * @fileType util
 * @domain kody
 * @pattern preview-session-token
 *
 * Stateless HMAC tokens for granting access to Fly preview machines.
 * The dashboard mints a ticket (HMAC of the preview identity + expiry, keyed by a derived
 * verify-only key) and appends it as a query param on the first iframe load.
 * The doorman proxy in each preview machine recomputes the HMAC; valid ticket
 * → Set-Cookie, then proxy through; invalid/missing/expired → 401.
 *
 * The verify-only key is derived from `KODY_MASTER_KEY` via HKDF with info
 * `"kody-preview:v1"` — distinct from the `"kody-chat-token:"` purpose that
 * chat-token.ts uses. Rotating `KODY_MASTER_KEY` invalidates all in-flight
 * preview tickets (same semantics as chat-token).
 */

import crypto from "crypto";

const PREVIEW_KEY_INFO = "kody-preview:v1";
const HMAC_BYTES = 16; // 128 bits — same output size as chat-token

/**
 * Derive a 32-byte verify-only key from `KODY_MASTER_KEY` using HKDF-SHA256.
 * This derived key is what ships to preview machines (via runtime env), not
 * the raw master key — containing blast radius if a preview machine env leaks.
 *
 * Throws if `KODY_MASTER_KEY` is not configured (same hard dependency as
 * `chat-token.ts` and `vapid-keys.ts`).
 */
export function derivePreviewKey(): Buffer {
  const masterRaw = process.env.KODY_MASTER_KEY?.trim();
  if (!masterRaw) {
    throw new Error(
      "KODY_MASTER_KEY is not configured — required for preview ticket derivation",
    );
  }

  let masterBytes: Buffer;
  if (/^[0-9a-fA-F]+$/.test(masterRaw) && masterRaw.length === 64) {
    masterBytes = Buffer.from(masterRaw, "hex");
  } else {
    masterBytes = Buffer.from(
      masterRaw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    );
  }

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      masterBytes,
      Buffer.alloc(0),
      PREVIEW_KEY_INFO,
      32,
    ),
  );
}

/**
 * Mint a preview ticket.
 *
 * @param repo       "owner/name"
 * @param pr         PR number
 * @param ttlSec     Seconds until expiry
 * @returns          Opaque ticket string (base64url of { r, p, e, s })
 */
export function mintPreviewTicket(
  repo: string,
  pr: number,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  return mintTicket({ r: repo, p: pr }, ttlSec);
}

export function mintBranchPreviewTicket(
  repo: string,
  branch: string,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  return mintTicket({ r: repo, b: branch }, ttlSec);
}

type PreviewTicketIdentity =
  | { r: string; p: number; b?: never }
  | { r: string; b: string; p?: never };

type PreviewTicketPayload = PreviewTicketIdentity & {
  e: number;
  s: string;
};

function buildSubject(identity: PreviewTicketIdentity, exp: number): string {
  if ("p" in identity) return `${identity.r}#${identity.p}:${exp}`;
  return `${identity.r}@${identity.b}:${exp}`;
}

function mintTicket(
  identity: PreviewTicketIdentity,
  ttlSec: number,
): { ticket: string; expiresAt: number } {
  const derivedKey = derivePreviewKey();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const subject = buildSubject(identity, exp);

  const sig = crypto
    .createHmac("sha256", derivedKey)
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  const payload = {
    ...identity,
    e: exp,
    s: sig,
  };

  // base64url encoding
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return { ticket: encoded, expiresAt: exp };
}

function decodePreviewTicket(ticket: string): PreviewTicketPayload | null {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const hasPr = typeof p.p === "number";
  const hasBranch = typeof p.b === "string";
  if (
    typeof p.r !== "string" ||
    typeof p.e !== "number" ||
    typeof p.s !== "string" ||
    hasPr === hasBranch
  ) {
    return null;
  }

  return p as PreviewTicketPayload;
}

/**
 * Verify a preview ticket.
 *
 * @param ticket     Opaque ticket from mintPreviewTicket
 * @param repo       "owner/name" — must match what was signed
 * @param pr         PR number — must match what was signed
 * @returns          true if valid and not expired; false otherwise
 */
export function verifyPreviewTicket(
  ticket: string,
  repo: string,
  pr: number,
): boolean {
  return verifyTicket(ticket, { r: repo, p: pr });
}

export function verifyBranchPreviewTicket(
  ticket: string,
  repo: string,
  branch: string,
): boolean {
  return verifyTicket(ticket, { r: repo, b: branch });
}

function sameIdentity(
  payload: PreviewTicketPayload,
  expected: PreviewTicketIdentity,
): boolean {
  if (payload.r !== expected.r) return false;
  if ("p" in expected) return payload.p === expected.p;
  return payload.b === expected.b;
}

function verifyTicket(
  ticket: string,
  expected: PreviewTicketIdentity,
): boolean {
  const payload = decodePreviewTicket(ticket);
  if (!payload) return false;

  // Envelope must match what the caller claims
  if (!sameIdentity(payload, expected)) return false;

  // Check expiry first (no crypto work if already expired)
  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.e) return false;

  // Re-derive the key and recompute the HMAC
  let derivedKey: Buffer;
  try {
    derivedKey = derivePreviewKey();
  } catch {
    return false;
  }

  const subject = buildSubject(expected, payload.e);
  const expectedSig = crypto
    .createHmac("sha256", derivedKey)
    .update(subject)
    .digest("hex")
    .slice(0, HMAC_BYTES * 2);

  const a = Buffer.from(payload.s, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
