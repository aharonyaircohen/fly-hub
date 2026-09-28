import { describe, expect, it } from "vitest";

import { parseAccountRepositoryCredentials } from "@dashboard/lib/auth/account-repository-connections";

describe("account repository credentials", () => {
  it("returns only validated repository access fields", () => {
    expect(
      parseAccountRepositoryCredentials({
        repoUrl: "https://github.com/acme/source",
        owner: "acme",
        repo: "source",
        token: "source-token",
        user: { login: "alice", avatar_url: "", id: 42 },
        loggedInAt: 1,
        repos: [
          {
            repoUrl: "https://github.com/acme/source",
            owner: "acme",
            repo: "source",
            token: "source-token",
            addedAt: 1,
            isLogin: true,
          },
        ],
        currentRepoIndex: 0,
      }),
    ).toEqual([
      {
        owner: "acme",
        repo: "source",
        token: "source-token",
        actorGithubId: 42,
      },
    ]);
  });

  it("rejects malformed stored credentials", () => {
    expect(parseAccountRepositoryCredentials({ repos: [] })).toEqual([]);
  });
});
