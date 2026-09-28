import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentKodySessionUser = vi.fn();
vi.mock("@dashboard/lib/auth/kody-auth-server", () => ({
  getCurrentKodySessionUser,
}));

describe("requireKodyUser", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the Better Auth session identity", async () => {
    getCurrentKodySessionUser.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.test",
    });
    const { requireKodyUser } = await import("@dashboard/lib/auth/kody-user");
    await expect(requireKodyUser()).resolves.toEqual({
      id: "user-1",
      label: "Alice",
      email: "alice@example.test",
    });
  });

  it("rejects requests without a Better Auth session", async () => {
    getCurrentKodySessionUser.mockResolvedValue(null);
    const { requireKodyUser } = await import("@dashboard/lib/auth/kody-user");
    const response = await requireKodyUser();
    expect(response).toMatchObject({ status: 401 });
  });
});
