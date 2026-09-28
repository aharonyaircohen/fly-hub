import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const github = vi.hoisted(() => ({
  createUserOctokit: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: github.createUserOctokit,
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  github.createUserOctokit.mockReset();
});

describe("GET /api/kody/auth/me", () => {
  it("does not report an env token as a browser login", async () => {
    vi.stubEnv("KODY_BOT_TOKEN", "bot-token");
    const { GET } = await import("../../app/api/kody/auth/me/route");

    const res = await GET(
      new NextRequest("https://dash.test/api/kody/auth/me"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ authenticated: false });
    expect(github.createUserOctokit).not.toHaveBeenCalled();
  });

  it("creates a secure Kody operator session after GitHub verifies the user", async () => {
    vi.stubEnv("KODY_MASTER_KEY", "test-master-key-that-is-long-enough");
    github.createUserOctokit.mockResolvedValue({
      rest: {
        users: {
          getAuthenticated: vi.fn(async () => ({
            data: {
              login: "alice",
              id: 42,
              avatar_url: "https://example.test/alice.png",
            },
          })),
        },
      },
    });
    const { GET } = await import("../../app/api/kody/auth/me/route");

    const res = await GET(
      new NextRequest("https://dash.test/api/kody/auth/me", {
        headers: { "x-kody-token": "github-token" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("kody_operator_session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("clears the Kody operator session on logout", async () => {
    const { DELETE } = await import("../../app/api/kody/auth/me/route");

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("kody_operator_session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
