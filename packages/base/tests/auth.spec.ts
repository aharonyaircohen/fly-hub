import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  getRepository: vi.fn(),
}));

vi.mock("../src/github/core", () => ({
  createUserOctokit: () => ({
    rest: {
      users: { getAuthenticated: github.getAuthenticated },
      repos: { get: github.getRepository },
    },
  }),
}));

import {
  getUserRequestAuth,
  requireUserAuth,
  verifyActorLogin,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "../src/auth";

function request(token = "token") {
  return new NextRequest("https://dash.test/api", {
    headers: {
      "x-kody-token": token,
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  github.getAuthenticated.mockResolvedValue({
    data: { login: "alice", id: 42, avatar_url: "https://example.test/a.png" },
  });
  github.getRepository.mockResolvedValue({
    data: { permissions: { admin: false, push: true, pull: true } },
  });
});

describe("user authentication", () => {
  it("accepts a PAT without requiring repository headers", async () => {
    const req = new NextRequest("https://dash.test/api", {
      headers: { "x-kody-token": "token" },
    });

    expect(getUserRequestAuth(req)).toEqual({ token: "token" });
    await expect(requireUserAuth(req)).resolves.toBeNull();
    await expect(verifyActorLogin(req, "alice")).resolves.toMatchObject({
      identity: { login: "alice", githubId: 42 },
    });
  });

  it("retries temporary GitHub failures before verifying the actor", async () => {
    vi.useFakeTimers();
    github.getAuthenticated
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({
        data: {
          login: "alice",
          id: 42,
          avatar_url: "https://example.test/a.png",
        },
      });

    try {
      const verification = verifyActorLogin(
        request("temporary-failure"),
        "alice",
      );
      await vi.runAllTimersAsync();

      await expect(verification).resolves.toMatchObject({
        identity: { login: "alice", githubId: 42 },
      });
      expect(github.getAuthenticated).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports GitHub outages separately from invalid credentials", async () => {
    vi.useFakeTimers();
    github.getAuthenticated.mockRejectedValue({ status: 503 });

    try {
      const verification = verifyActorLogin(request("github-outage"), "alice");
      await vi.runAllTimersAsync();
      const response = await verification;

      expect(response).toMatchObject({ status: 503 });
      await expect((response as Response).json()).resolves.toMatchObject({
        error: "github_identity_unavailable",
      });
      expect(github.getAuthenticated).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry invalid GitHub credentials", async () => {
    github.getAuthenticated.mockRejectedValue({ status: 401 });

    const response = await verifyActorLogin(
      request("invalid-user-token"),
      "alice",
    );

    expect(response).toMatchObject({ status: 401 });
    expect(github.getAuthenticated).toHaveBeenCalledTimes(1);
  });
});

describe("repository access verification", () => {
  it("accepts read collaborators but does not grant them write access", async () => {
    github.getRepository.mockResolvedValue({
      data: { permissions: { admin: false, push: false, pull: true } },
    });

    await expect(verifyRepoReadAccess(request())).resolves.toMatchObject({
      actorLogin: "alice",
      permission: "pull",
    });
    const write = await verifyRepoWriteAccess(request());
    expect(write).toMatchObject({ status: 403 });
  });

  it("accepts GitHub push permission as write access", async () => {
    github.getRepository.mockResolvedValue({
      data: { permissions: { admin: false, push: true, pull: true } },
    });

    await expect(verifyRepoWriteAccess(request())).resolves.toMatchObject({
      actorLogin: "alice",
      permission: "push",
    });
  });

  it("rejects invalid tokens and missing headers", async () => {
    github.getAuthenticated.mockRejectedValue({ status: 401 });
    const invalidToken = await verifyRepoReadAccess(request("invalid"));
    expect(invalidToken).toMatchObject({ status: 401 });
    await expect((invalidToken as Response).json()).resolves.toMatchObject({
      error: "invalid_token",
    });
    await expect(
      verifyRepoReadAccess(new NextRequest("https://dash.test/api")),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("reports repository permission lookup failures separately", async () => {
    github.getRepository.mockRejectedValue({ status: 404 });

    const response = await verifyRepoWriteAccess(request());

    expect(response).toMatchObject({ status: 404 });
    await expect((response as Response).json()).resolves.toMatchObject({
      error: "repository_not_found_or_inaccessible",
    });
  });

  it("preserves GitHub permission denials without leaking details", async () => {
    github.getRepository.mockRejectedValue({ status: 403 });

    const response = await verifyRepoWriteAccess(request());

    expect(response).toMatchObject({ status: 403 });
    await expect((response as Response).json()).resolves.toMatchObject({
      error: "github_permission_verification_forbidden",
    });
  });
});
