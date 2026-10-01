import { beforeEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { encrypt } from "@kody-ade/base/vault/crypto";
import { appCredentials } from "@dashboard/lib/fly-hub-app-credentials";
beforeEach(() => {
  process.env.KODY_MASTER_KEY = "33".repeat(32);
});
const hash = (password: string) =>
  createHash("sha256").update(password).digest("hex");
describe("deployed app credentials", () => {
  it("uses the current stored password even when a retry supplies a new seed", () => {
    expect(
      appCredentials(
        {
          FLY_HUB_PASSWORD_HASH: hash("current"),
          FLY_HUB_PASSWORD_ENCRYPTED: encrypt("current"),
        },
        "aa".repeat(32),
      ).password,
    ).toBe("current");
  });
  it("does not invent credentials when the old app does not match this run", () => {
    expect(
      appCredentials(
        {
          FLY_HUB_PASSWORD_HASH: hash("old"),
          FLY_HUB_APP_PASSWORD_ENV: "LOGIN_PASSWORD",
        },
        "aa".repeat(32),
      ),
    ).toEqual({ password: null, appCredential: null });
  });
  it("recovers a legacy password only when it matches the running gateway", () => {
    const seed = "aa".repeat(32);
    const password = createHmac("sha256", Buffer.from(seed, "hex"))
      .update("outer")
      .digest("base64url")
      .slice(0, 32);
    expect(
      appCredentials({ FLY_HUB_PASSWORD_HASH: hash(password) }, seed).password,
    ).toBe(password);
  });
  it("retains the inner login password after an outer password reset", () => {
    expect(
      appCredentials({
        FLY_HUB_PASSWORD_HASH: hash("reset"),
        FLY_HUB_PASSWORD_ENCRYPTED: encrypt("reset"),
        FLY_HUB_APP_PASSWORD_ENV: "LOGIN_PASSWORD",
        FLY_HUB_APP_PASSWORD_ENCRYPTED: encrypt("inner"),
      }).appCredential,
    ).toEqual({ name: "LOGIN_PASSWORD", password: "inner" });
  });
});
