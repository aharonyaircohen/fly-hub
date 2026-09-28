import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeRepoSelectionMatchesAuth,
  refreshRepoIdentity,
  type KodyAuth,
} from "@dashboard/lib/auth-context";

const alice = { login: "alice", avatar_url: "https://example.test/a", id: 1 };
const bob = { login: "bob", avatar_url: "https://example.test/b", id: 2 };

function twoAccountAuth(): KodyAuth {
  return {
    owner: "bob-org",
    repo: "second",
    repoUrl: "https://github.com/bob-org/second",
    token: "token-bob",
    user: alice,
    loggedInAt: 1,
    currentRepoIndex: 1,
    repos: [
      {
        owner: "alice-org",
        repo: "first",
        repoUrl: "https://github.com/alice-org/first",
        token: "token-alice",
        user: alice,
        addedAt: 1,
        isLogin: true,
      },
      {
        owner: "bob-org",
        repo: "second",
        repoUrl: "https://github.com/bob-org/second",
        token: "token-bob",
        addedAt: 2,
        isLogin: false,
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("repository GitHub identity", () => {
  it("treats a matching repo without a copied user as stable", () => {
    const auth = twoAccountAuth();

    expect(
      activeRepoSelectionMatchesAuth(
        {
          owner: auth.owner,
          repo: auth.repo,
          repoUrl: auth.repoUrl,
          token: auth.token,
          index: auth.currentRepoIndex,
        },
        auth,
      ),
    ).toBe(true);
  });

  it("verifies and stores the account that owns an existing repo token", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "x-kody-token": "token-bob",
        "x-kody-owner": "bob-org",
        "x-kody-repo": "second",
      });
      return new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            login: bob.login,
            avatar_url: bob.avatar_url,
            githubId: bob.id,
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshRepoIdentity(
      twoAccountAuth(),
      "/repo/bob-org/second/secrets",
    );

    expect(refreshed.user).toEqual(bob);
    expect(refreshed.repos[1].user).toEqual(bob);
    expect(refreshed.repos[0].user).toEqual(alice);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a repository identity that was already verified", async () => {
    const auth = twoAccountAuth();
    auth.repos[1] = { ...auth.repos[1], user: bob };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshRepoIdentity(
      auth,
      "/repo/bob-org/second/secrets",
    );

    expect(refreshed.user).toEqual(bob);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
