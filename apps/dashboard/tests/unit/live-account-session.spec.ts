import { describe, expect, it, vi } from "vitest";

import {
  establishLiveKodyAccountSession,
  loadLiveKodyAccountCredentialsFromDashboard,
  readLiveKodyAccountCredentials,
} from "../../tests/e2e/live-account-session";

const EMAIL = "quality@example.test";
const PASSWORD = "password-that-must-not-leak";

describe("live Kody account session", () => {
  it("requires configured test-account credentials", () => {
    expect(() => readLiveKodyAccountCredentials({})).toThrow(
      "Kody Quality requires a configured test account",
    );
  });

  it("loads repository credentials from the Dashboard deployment under test", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        ok: () => true,
        status: () => 200,
        json: () =>
          Promise.resolve({
            variables: [
              {
                name: "LOGIN_USER",
                value: "deployed-quality@example.test",
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: () => true,
        status: () => 200,
        json: () => Promise.resolve({ value: "deployed-password" }),
      });

    await expect(
      loadLiveKodyAccountCredentialsFromDashboard(
        { get, post: vi.fn() },
        "https://candidate.example.test",
        {
          E2E_GITHUB_TOKEN: "github-token",
          E2E_KODY_CREDENTIALS_REPO:
            "https://github.com/example/central-quality-account",
        },
      ),
    ).resolves.toEqual({
      email: "deployed-quality@example.test",
      password: "deployed-password",
    });

    expect(get).toHaveBeenNthCalledWith(
      1,
      "https://candidate.example.test/api/kody/variables",
      {
        headers: expect.objectContaining({
          "x-kody-repo": "central-quality-account",
        }),
      },
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      "https://candidate.example.test/api/kody/secrets/LOGIN_PASSWORD/value",
      {
        headers: expect.objectContaining({
          "x-kody-repo": "central-quality-account",
        }),
      },
    );
  });

  it("does not treat the target repository as the central credential source", async () => {
    const get = vi.fn();

    await expect(
      loadLiveKodyAccountCredentialsFromDashboard(
        { get, post: vi.fn() },
        "https://candidate.example.test",
        {
          E2E_GITHUB_TOKEN: "github-token",
          E2E_GITHUB_REPO: "https://github.com/example/target-repository",
        },
      ),
    ).rejects.toThrow("Kody Quality requires a configured test account");

    expect(get).not.toHaveBeenCalled();
  });

  it("signs in through Kody and verifies the resulting session", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({
        ok: () => true,
        status: () => 200,
        headersArray: () => [
          {
            name: "set-cookie",
            value: "kody.session=fresh-session; Path=/; HttpOnly; Secure",
          },
        ],
      });
    const get = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      json: () => Promise.resolve({ user: { id: "quality-user" } }),
    });

    const cookieHeader = await establishLiveKodyAccountSession(
      { post, get },
      "https://quality.example.test",
      { email: EMAIL, password: PASSWORD },
    );

    expect(post).toHaveBeenCalledWith(
      "https://quality.example.test/api/auth/sign-in/email",
      {
        data: { email: EMAIL, password: PASSWORD, callbackURL: "/chat" },
        headers: { Origin: "https://quality.example.test" },
      },
    );
    expect(get).toHaveBeenCalledWith(
      "https://quality.example.test/api/auth/get-session",
    );
    expect(cookieHeader).toBe("kody.session=fresh-session");
  });

  it("can authenticate an unpromoted deployment through a trusted origin", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ ok: () => true, status: () => 200 });
    const get = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      json: () => Promise.resolve({ user: { id: "quality-user" } }),
    });

    await establishLiveKodyAccountSession(
      { post, get },
      "https://candidate.example.test",
      { email: EMAIL, password: PASSWORD },
      "https://dashboard.example.test",
    );

    expect(post).toHaveBeenCalledWith(
      "https://candidate.example.test/api/auth/sign-in/email",
      expect.objectContaining({
        headers: { Origin: "https://dashboard.example.test" },
      }),
    );
    expect(get).toHaveBeenCalledWith(
      "https://candidate.example.test/api/auth/get-session",
    );
  });

  it("never includes credentials or server response text in login errors", async () => {
    const post = vi.fn().mockResolvedValue({
      ok: () => false,
      status: () => 401,
      text: () => Promise.resolve(`bad ${EMAIL} ${PASSWORD}`),
    });

    const error = await establishLiveKodyAccountSession(
      { post, get: vi.fn() },
      "https://quality.example.test",
      { email: EMAIL, password: PASSWORD },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Kody account sign-in failed (401)");
    expect((error as Error).message).not.toContain(EMAIL);
    expect((error as Error).message).not.toContain(PASSWORD);
  });

  it("rejects a successful sign-in response without a real session", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ ok: () => true, status: () => 200 });
    const get = vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      json: () => Promise.resolve(null),
    });

    await expect(
      establishLiveKodyAccountSession(
        { post, get },
        "https://quality.example.test",
        { email: EMAIL, password: PASSWORD },
      ),
    ).rejects.toThrow("Kody account session was not established (200)");
  });
});
