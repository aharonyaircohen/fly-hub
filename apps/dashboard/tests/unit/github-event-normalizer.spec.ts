import { describe, expect, it } from "vitest";
import { normalizeGitHubWebhookEvent } from "../../src/dashboard/features/workflows/server/github-event-normalizer";

describe("normalizeGitHubWebhookEvent", () => {
  it("normalizes a completed workflow run into a typed event", () => {
    const event = normalizeGitHubWebhookEvent({
      eventType: "workflow_run",
      deliveryId: "delivery-1",
      now: () => "2026-08-04T07:00:00.000Z",
      payload: {
        action: "completed",
        workflow_run: {
          id: 42,
          run_attempt: 2,
          workflow_id: 7,
          name: "CI",
          path: ".github/workflows/ci.yml",
          conclusion: "failure",
          head_branch: "main",
          head_sha: "abc1234",
          event: "push",
          html_url: "https://github.com/acme/shop/actions/runs/42",
          pull_requests: [{ number: 73 }],
        },
        repository: { full_name: "acme/shop" },
        sender: { id: 99, login: "octocat" },
      },
    });

    expect(event).toEqual({
      id: "delivery-1",
      name: "github.workflow_run.completed",
      version: 3,
      occurredAt: "2026-08-04T07:00:00.000Z",
      userId: "github:99",
      sessionId: null,
      brand: { owner: "acme", repo: "shop" },
      source: "server",
      payload: {
        runId: 42,
        runAttempt: 2,
        workflowId: 7,
        workflowName: "CI",
        workflowPath: ".github/workflows/ci.yml",
        conclusion: "failure",
        branch: "main",
        headSha: "abc1234",
        pr: 73,
        event: "push",
        repository: "acme/shop",
        actor: "octocat",
        htmlUrl: "https://github.com/acme/shop/actions/runs/42",
      },
    });
  });

  it("does not guess a PR when a workflow run belongs to multiple pull requests", () => {
    const event = normalizeGitHubWebhookEvent({
      eventType: "workflow_run",
      deliveryId: "delivery-many-prs",
      payload: {
        action: "completed",
        workflow_run: {
          id: 43,
          conclusion: "success",
          head_sha: "def4567",
          pull_requests: [{ number: 73 }, { number: 74 }],
        },
        repository: { full_name: "acme/shop" },
      },
    });

    expect(event?.payload).toMatchObject({ headSha: "def4567" });
    expect(event?.payload).not.toHaveProperty("pr");
  });

  it("ignores unsupported or malformed webhook payloads", () => {
    expect(
      normalizeGitHubWebhookEvent({
        eventType: "workflow_run",
        deliveryId: "d",
        payload: { action: "requested" },
      }),
    ).toBeNull();
    expect(
      normalizeGitHubWebhookEvent({
        eventType: "issues",
        deliveryId: "d",
        payload: {},
      }),
    ).toBeNull();
  });
});
