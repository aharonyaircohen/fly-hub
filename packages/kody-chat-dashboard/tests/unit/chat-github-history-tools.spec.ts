import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/dashboard/lib/github-client", () => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createGitHubTools } from "../../app/api/kody/chat/tools/github-tools";

describe("GitHub assessment history tools", () => {
  it("pages repository-wide commits with contributor identity", async () => {
    const listCommits = vi.fn().mockResolvedValue({
      data: [
        {
          sha: "1234567890",
          author: { login: "octocat" },
          commit: {
            author: { name: "Octo Cat", date: "2026-08-01T00:00:00Z" },
            committer: { date: "2026-08-01T00:00:00Z" },
            message: "Improve assessment\n\nDetails",
          },
          html_url: "https://github.com/acme/app/commit/1234567890",
        },
      ],
    });
    const tools = createGitHubTools({
      owner: "acme",
      repo: "app",
      octokit: { rest: { repos: { listCommits } } } as never,
    }) as unknown as {
      github_list_commits: { execute(input: unknown): Promise<unknown> };
    };

    await expect(
      tools.github_list_commits.execute({ page: 2, perPage: 100 }),
    ).resolves.toMatchObject({
      page: 2,
      commits: [
        {
          sha: "12345678",
          author: "octocat",
          message: "Improve assessment",
        },
      ],
    });
    expect(listCommits).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "app", page: 2 }),
    );
  });

  it("pages Actions history with workflow outcomes and actors", async () => {
    const listWorkflowRunsForRepo = vi.fn().mockResolvedValue({
      data: {
        total_count: 1,
        workflow_runs: [
          {
            id: 42,
            name: "CI",
            event: "push",
            status: "completed",
            conclusion: "failure",
            run_started_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:03:00Z",
            actor: { login: "octocat" },
            head_sha: "1234567890",
            html_url: "https://github.com/acme/app/actions/runs/42",
          },
        ],
      },
    });
    const tools = createGitHubTools({
      owner: "acme",
      repo: "app",
      octokit: { rest: { actions: { listWorkflowRunsForRepo } } } as never,
    }) as unknown as {
      github_list_workflow_runs: { execute(input: unknown): Promise<unknown> };
    };

    await expect(
      tools.github_list_workflow_runs.execute({ page: 1, perPage: 50 }),
    ).resolves.toMatchObject({
      totalCount: 1,
      runs: [{ id: 42, name: "CI", conclusion: "failure", actor: "octocat" }],
    });
  });
});
