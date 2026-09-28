import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  credential: vi.fn(),
  verify: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@dashboard/lib/brain/personal-services", () => ({}));
vi.mock("@kody-ade/brain/agent-access", () => ({
  authenticateAgentAccess: mocks.authenticate,
  agentTokenId: () => "safe-id",
}));
vi.mock("@kody-ade/brain/personal-services", () => ({
  getPersonalBrainServices: () => ({ getCredential: mocks.credential }),
}));
vi.mock("@kody-ade/base/auth", () => ({ verifyRepoWriteAccess: mocks.verify }));
vi.mock("@dashboard/lib/auth/account-repository-connections", () => ({
  ACCOUNT_REPOSITORY_CREDENTIAL_NAME: "KODY_INTERNAL_REPOSITORY_CONNECTIONS",
  parseAccountRepositoryCredentials: (value: unknown) =>
    Array.isArray((value as { repos?: unknown[] })?.repos)
      ? (value as { repos: unknown[] }).repos
      : [],
}));
vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: { mcpRateLimits: { check: "check" } },
  getConvexClient: () => ({ mutation: mocks.rate }),
}));
import {
  requireAgentRepository,
  requireBrainAgent,
} from "../../src/dashboard/lib/brain/agent-access";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.credential.mockResolvedValue("owner-saved-token");
  mocks.rate.mockResolvedValue(true);
});
it("uses only the owner token and ignores caller-supplied GitHub identity", async () => {
  const req = new NextRequest("https://kody.example", {
    headers: { "x-kody-token": "attacker", "x-kody-user-login": "admin" },
  });
  mocks.verify.mockResolvedValue({});
  await requireAgentRepository(req, "owner-id", "alice/project");
  const verified = mocks.verify.mock.calls[0][0] as NextRequest;
  expect(verified.headers.get("x-kody-token")).toBe("owner-saved-token");
  expect(verified.headers.get("x-kody-owner")).toBe("alice");
  expect(verified.headers.get("x-kody-repo")).toBe("project");
  expect(verified.headers.get("x-kody-user-login")).toBeNull();
  expect(mocks.credential).toHaveBeenCalledWith("owner-id", "GITHUB_TOKEN");
});
it("reuses the matching saved repository connection when no duplicate token exists", async () => {
  mocks.credential.mockImplementation(async (_userId, name) =>
    name === "KODY_INTERNAL_REPOSITORY_CONNECTIONS"
      ? JSON.stringify({
          repos: [
            { owner: "alice", repo: "project", token: "repository-token" },
          ],
        })
      : null,
  );
  mocks.verify.mockResolvedValue({});
  await requireAgentRepository(
    new NextRequest("https://kody.example"),
    "owner-id",
    "alice/project",
  );
  const verified = mocks.verify.mock.calls[0][0] as NextRequest;
  expect(verified.headers.get("x-kody-token")).toBe("repository-token");
  expect(mocks.credential).toHaveBeenCalledWith(
    "owner-id",
    "KODY_INTERNAL_REPOSITORY_CONNECTIONS",
  );
});
it("fails closed for malformed repositories and missing saved identity", async () => {
  expect(
    (
      (await requireAgentRepository(
        new NextRequest("https://kody.example"),
        "owner",
        "../alice/project",
      )) as NextResponse
    ).status,
  ).toBe(400);
  mocks.credential.mockResolvedValue(null);
  expect(
    (
      (await requireAgentRepository(
        new NextRequest("https://kody.example"),
        "owner",
        "alice/project",
      )) as NextResponse
    ).status,
  ).toBe(403);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("rejects an invalid machine before checking rate limits", async () => {
  mocks.authenticate.mockResolvedValue(null);
  expect(
    (
      (await requireBrainAgent(
        new NextRequest("https://kody.example"),
      )) as NextResponse
    ).status,
  ).toBe(401);
  expect(mocks.rate).not.toHaveBeenCalled();
});
it("rate limits valid machine identities", async () => {
  mocks.authenticate.mockResolvedValue({ userId: "owner" });
  mocks.rate.mockResolvedValue(false);
  expect(
    (
      (await requireBrainAgent(
        new NextRequest("https://kody.example", {
          headers: { authorization: "Bearer identity" },
        }),
      )) as NextResponse
    ).status,
  ).toBe(429);
});
