import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  readOperators: vi.fn(),
  appendInboxFeed: vi.fn(),
}));

vi.mock("@kody-ade/base/engine/config", () => ({
  readOperators: h.readOperators,
}));
vi.mock("@dashboard/lib/inbox/feed-server", () => ({
  appendInboxFeed: h.appendInboxFeed,
}));

import {
  deliverPipelineApprovalRequest,
  deliverWorkflowInboxAlert,
} from "@dashboard/features/workflows/server/workflow-inbox-alert";

describe("deliverWorkflowInboxAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.readOperators.mockResolvedValue(["Alice", "bob"]);
    h.appendInboxFeed.mockResolvedValue(2);
  });

  it("writes one deterministic Kody Inbox item per configured operator", async () => {
    await deliverWorkflowInboxAlert({
      owner: "acme",
      repo: "shop",
      workflowId: "review-fix",
      runId: "run-7",
      summary:
        "UI Review could not log in because the credentials were rejected.",
      url: "https://dashboard.example/repo/acme/shop/workflows/review-fix",
      octokit: {} as never,
    });

    expect(h.appendInboxFeed).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "kody-workflow:alice:review-fix:run-7",
        login: "alice",
        source: "kody",
        threadType: "Workflow",
        title: "Review Fix needs attention",
        snippet:
          "UI Review could not log in because the credentials were rejected.",
      }),
      expect.objectContaining({
        id: "kody-workflow:bob:review-fix:run-7",
        login: "bob",
      }),
    ]);
  });

  it("does nothing when the repository has no operators", async () => {
    h.readOperators.mockResolvedValue([]);

    await deliverWorkflowInboxAlert({
      owner: "acme",
      repo: "shop",
      workflowId: "review-fix",
      runId: "run-7",
      summary: "Blocked",
      url: "https://dashboard.example/repo/acme/shop/workflows/review-fix",
      octokit: {} as never,
    });

    expect(h.appendInboxFeed).not.toHaveBeenCalled();
  });

  it("creates a generic Pipeline approval request without requiring an issue", async () => {
    await deliverPipelineApprovalRequest({
      owner: "acme",
      repo: "shop",
      pipelineId: "release-check",
      runId: "run-8",
      summary: "Review before continuing.",
      url: "https://dashboard.example/repo/acme/shop/pipelines/release-check",
      octokit: {} as never,
    });

    expect(h.appendInboxFeed).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "kody-pipeline-approval:alice:release-check:run-8",
        source: "request",
        threadType: "Pipeline",
        pipelineApproval: {
          pipelineId: "release-check",
          runId: "run-8",
        },
      }),
      expect.any(Object),
    ]);
  });
});
