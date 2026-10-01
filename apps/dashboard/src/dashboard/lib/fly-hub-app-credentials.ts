import { createHash, createHmac } from "node:crypto";
import { decrypt } from "@kody-ade/base/vault/crypto";

// Older apps may recover credentials from their original run, but a retry's
// seed must never be presented as the password of an existing deployment.
export function appCredentials(
  env: Record<string, string>,
  passwordSeed?: string,
) {
  const derived = (label: string) =>
    passwordSeed
      ? createHmac("sha256", Buffer.from(passwordSeed, "hex"))
          .update(label)
          .digest("base64url")
          .slice(0, 32)
      : null;
  const recover = (encrypted?: string) => {
    try {
      return encrypted ? decrypt(encrypted) : null;
    } catch {
      return null;
    }
  };
  const matches = (password: string | null) =>
    Boolean(
      password &&
      createHash("sha256").update(password).digest("hex") ===
        env.FLY_HUB_PASSWORD_HASH,
    );
  const stored = recover(env.FLY_HUB_PASSWORD_ENCRYPTED);
  const original = derived("outer");
  const password = matches(stored)
    ? stored
    : matches(original)
      ? original
      : null;
  const inner =
    recover(env.FLY_HUB_APP_PASSWORD_ENCRYPTED) ??
    (matches(original) ? derived("inner") : null);
  return {
    password,
    appCredential:
      env.FLY_HUB_APP_PASSWORD_ENV && inner
        ? { name: env.FLY_HUB_APP_PASSWORD_ENV, password: inner }
        : null,
  };
}
