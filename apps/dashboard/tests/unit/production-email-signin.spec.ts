import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  options: null as null | {
    emailAndPassword?: { enabled?: boolean; disableSignUp?: boolean };
  },
}));
vi.mock("better-auth", () => ({
  betterAuth: (options: typeof captured.options) => {
    captured.options = options;
    return {};
  },
}));
vi.mock("@convex-dev/better-auth", () => ({
  createClient: () => ({ adapter: () => ({}) }),
}));
import { createAuth } from "../../../../packages/kody-backend/convex/betterAuth/auth";

describe("production email sign-in", () => {
  it("enables password sign-in while disabling public registration", () => {
    createAuth({} as Parameters<typeof createAuth>[0]);
    expect(captured.options?.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
    });
  });
});
