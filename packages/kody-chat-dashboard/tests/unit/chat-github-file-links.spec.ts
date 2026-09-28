import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/dashboard/lib/github-client", () => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createGitHubTools } from "../../app/api/kody/chat/tools/github-tools";

type GitHubSearchResult = {
  matches?: Array<{ path: string; url: string; lineInFragment: number | null }>;
  error?: string;
  status?: number;
  message?: string;
};

describe("github_search_code internal file links", () => {
  it("returns Kody /files links for connected-repo search results", async () => {
    const octokit = {
      rest: {
        search: {
          code: vi.fn().mockResolvedValue({
            data: {
              total_count: 2,
              items: [
                {
                  path: "src/dashboard/lib/api.ts",
                  html_url:
                    "https://github.com/acme/app/blob/main/src/dashboard/lib/api.ts",
                  text_matches: [],
                },
                {
                  path: "app/api/kody/tasks/route.ts",
                  html_url:
                    "https://github.com/acme/app/blob/main/app/api/kody/tasks/route.ts",
                  text_matches: [
                    {
                      fragment: "const issue = await createIssue()",
                      matches: [{ indices: [6, 11] }],
                    },
                  ],
                },
              ],
            },
          }),
        },
      },
    };
    const tools = createGitHubTools({
      owner: "acme",
      repo: "app",
      octokit: octokit as never,
    }) as unknown as {
      github_search_code: {
        execute: (input: unknown) => Promise<GitHubSearchResult>;
      };
    };

    const result = await tools.github_search_code.execute({ query: "issue" });

    expect(result.matches?.map((m) => m.url)).toEqual([
      "/files/src/dashboard/lib/api.ts",
      "/files/app/api/kody/tasks/route.ts",
    ]);
  });

  it("returns a terminal dependency failure when GitHub search is incomplete", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const searchCode = vi.fn().mockResolvedValue({
      data: {
        total_count: 0,
        incomplete_results: true,
        items: [],
      },
    });
    const octokit = {
      rest: {
        search: {
          code: searchCode,
        },
      },
    };
    const tools = createGitHubTools({
      owner: "acme",
      repo: "app",
      octokit: octokit as never,
      wait,
    }) as unknown as {
      github_search_code: {
        execute: (input: unknown) => Promise<GitHubSearchResult>;
      };
    };

    const result = await tools.github_search_code.execute({ query: "symbol" });

    expect(result).toEqual({
      error: "code_search_unavailable",
      status: 424,
      message:
        "GitHub code search is not ready for acme/app. Repository search results are incomplete; try again after GitHub finishes indexing the repository.",
    });
    expect(searchCode).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("uses the second result when an incomplete search recovers", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const searchCode = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          total_count: 0,
          incomplete_results: true,
          items: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              path: "src/recovered.ts",
              html_url:
                "https://github.com/acme/app/blob/main/src/recovered.ts",
              text_matches: [],
            },
          ],
        },
      });
    const tools = createGitHubTools({
      owner: "acme",
      repo: "app",
      octokit: { rest: { search: { code: searchCode } } } as never,
      wait,
    }) as unknown as {
      github_search_code: {
        execute: (input: unknown) => Promise<GitHubSearchResult>;
      };
    };

    const result = await tools.github_search_code.execute({ query: "symbol" });

    expect(result.matches?.map((match) => match.path)).toEqual([
      "src/recovered.ts",
    ]);
    expect(searchCode).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });
});
