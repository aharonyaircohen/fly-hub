import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  verifyActorLogin: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kody-ade/base/auth")>()),
  verifyActorLogin: auth.verifyActorLogin,
}));

describe("operator session", () => {
  beforeEach(() => {
    vi.stubEnv("KODY_MASTER_KEY", "test-master-key-that-is-long-enough");
    auth.verifyActorLogin.mockReset();
  });

  it("uses a fixed 30-day lifetime", async () => {
    const { OPERATOR_SESSION_TTL_SEC } = await import(
      "../../src/dashboard/lib/auth/operator-session"
    );

    expect(OPERATOR_SESSION_TTL_SEC).toBe(30 * 24 * 60 * 60);
  });

  it("verifies a signed operator without calling GitHub", async () => {
    const { mintOperatorSession, OPERATOR_SESSION_COOKIE } =
      await import("../../src/dashboard/lib/auth/operator-session");
    const { verifyOperatorActor } =
      await import("../../src/dashboard/lib/auth/operator-actor");
    const token = await mintOperatorSession({
      login: "alice",
      githubId: 42,
      avatarUrl: "https://example.test/alice.png",
    });
    const request = new NextRequest("https://dash.test/api", {
      headers: { cookie: `${OPERATOR_SESSION_COOKIE}=${token}` },
    });

    await expect(verifyOperatorActor(request, "alice")).resolves.toMatchObject({
      identity: { login: "alice", githubId: 42 },
    });
    expect(auth.verifyActorLogin).not.toHaveBeenCalled();
  });

  it("rejects a caller name that does not match the signed session", async () => {
    const { mintOperatorSession, OPERATOR_SESSION_COOKIE } =
      await import("../../src/dashboard/lib/auth/operator-session");
    const { verifyOperatorActor } =
      await import("../../src/dashboard/lib/auth/operator-actor");
    const token = await mintOperatorSession({
      login: "alice",
      githubId: 42,
      avatarUrl: "https://example.test/alice.png",
    });
    const result = await verifyOperatorActor(
      new NextRequest("https://dash.test/api", {
        headers: { cookie: `${OPERATOR_SESSION_COOKIE}=${token}` },
      }),
      "mallory",
    );

    expect(result).toBeInstanceOf(NextResponse);
    expect(result).toMatchObject({ status: 403 });
    expect(auth.verifyActorLogin).not.toHaveBeenCalled();
  });
});
