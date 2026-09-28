/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-file-key
 * @ai-summary Derives a filesystem-safe key from a unified userId
 *   (`operator:<login>` / `client:<email>`): readable sanitized slug plus an
 *   8-char sha256 suffix so distinct ids that sanitize identically can
 *   never collide.
 */
import { createHash } from "node:crypto";

const MAX_SLUG_LENGTH = 60;

export function userFileKey(userId: string): string {
  const slug = userId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return slug ? `${slug}-${hash}` : hash;
}
