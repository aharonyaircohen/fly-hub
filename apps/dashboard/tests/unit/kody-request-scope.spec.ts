import { beforeEach, describe, expect, it, vi } from "vitest";

const requireKodyUser = vi.fn();
const getRequestAuth = vi.fn();
const verifyRepoReadAccess = vi.fn();
const verifyRepoWriteAccess = vi.fn();

vi.mock("@dashboard/lib/auth/kody-user", () => ({ requireKodyUser }));
vi.mock("@kody-ade/base/auth", () => ({
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
}));

describe("resolveKodyRequestScope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a personal scope for a signed-in user without GitHub", async () => {
    requireKodyUser.mockResolvedValue({ id: "user-1", label: "User" });
    getRequestAuth.mockReturnValue(null);
    const { resolveKodyRequestScope } =
      await import("@dashboard/lib/auth/kody-request-scope");

    const result = await resolveKodyRequestScope({ method: "GET" } as never);

    expect(result).toMatchObject({
      user: { id: "user-1" },
      scope: { kind: "personal", userId: "user-1" },
      tenantId: "user:user-1",
      repository: null,
    });
  });

  it("adds repository context without replacing the personal identity", async () => {
    requireKodyUser.mockResolvedValue({ id: "user-1", label: "User" });
    getRequestAuth.mockReturnValue({ owner: "acme", repo: "app", token: "x" });
    verifyRepoReadAccess.mockResolvedValue({
      auth: { owner: "acme", repo: "app", token: "x" },
    });
    const { resolveKodyRequestScope } =
      await import("@dashboard/lib/auth/kody-request-scope");

    const result = await resolveKodyRequestScope({ method: "GET" } as never);

    expect(result).toMatchObject({
      user: { id: "user-1" },
      scope: {
        kind: "repository",
        userId: "user-1",
        owner: "acme",
        repo: "app",
      },
      tenantId: "acme/app",
      personalTenantId: "user:user-1",
      repository: { owner: "acme", repo: "app", token: "x" },
    });
  });
});

it("does not grant repository scope merely because the user has a Kody session", async () => {
  const { NextResponse } = await import("next/server");
  requireKodyUser.mockResolvedValue({ id: "user-1" });
  getRequestAuth.mockReturnValue({ owner: "private", repo: "app", token: "x" });
  verifyRepoWriteAccess.mockResolvedValue(
    NextResponse.json({ error: "write_permission_required" }, { status: 403 }),
  );
  const { resolveKodyRequestScope } =
    await import("@dashboard/lib/auth/kody-request-scope");
  expect(
    await resolveKodyRequestScope({ method: "POST" } as never),
  ).toMatchObject({ status: 403 });
});
