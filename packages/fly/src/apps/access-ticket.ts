import crypto from "node:crypto";
const INFO = "kody-app-launch:v1";
export function deriveAppLaunchKey(): Buffer {
  const raw = process.env.KODY_MASTER_KEY?.trim();
  if (!raw)
    throw new Error("KODY_MASTER_KEY is required for App launch tickets");
  const master = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return Buffer.from(
    crypto.hkdfSync("sha256", master, Buffer.alloc(0), INFO, 32),
  );
}
export function mintAppLaunchTicket(
  repository: string,
  appId: string,
  ttlSec = 300,
) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec,
    subject = `${repository}:${appId}:${expiresAt}`,
    signature = crypto
      .createHmac("sha256", deriveAppLaunchKey())
      .update(subject)
      .digest("hex")
      .slice(0, 32);
  return {
    ticket: Buffer.from(
      JSON.stringify({ r: repository, a: appId, e: expiresAt, s: signature }),
    ).toString("base64url"),
    expiresAt,
  };
}
export function verifyAppLaunchTicket(
  ticket: string,
  repository: string,
  appId: string,
  key = deriveAppLaunchKey(),
  now = Math.floor(Date.now() / 1000),
) {
  try {
    const value = JSON.parse(
      Buffer.from(ticket, "base64url").toString("utf8"),
    ) as { r?: unknown; a?: unknown; e?: unknown; s?: unknown };
    if (
      value.r !== repository ||
      value.a !== appId ||
      typeof value.e !== "number" ||
      typeof value.s !== "string" ||
      now >= value.e
    )
      return false;
    const expected = crypto
        .createHmac("sha256", key)
        .update(`${repository}:${appId}:${value.e}`)
        .digest("hex")
        .slice(0, 32),
      a = Buffer.from(value.s, "hex"),
      b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
