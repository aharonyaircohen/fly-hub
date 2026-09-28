import { describe, expect, it } from "vitest";
import {
  generateAppAccessToken,
  hashAppAccessToken,
  verifyAppAccessToken,
} from "../../src/apps/access-token";

describe("private App access tokens", () => {
  it("generates opaque tokens and stores only a one-way hash", () => {
    const token = generateAppAccessToken();
    const digest = hashAppAccessToken(token);
    expect(token).toMatch(/^kody_app_[A-Za-z0-9_-]{40,}$/);
    expect(digest).not.toContain(token);
    expect(verifyAppAccessToken(token, digest)).toBe(true);
    expect(verifyAppAccessToken(`${token}x`, digest)).toBe(false);
  });
});
