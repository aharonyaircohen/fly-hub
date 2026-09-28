import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutateNotificationsManifest: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({ Octokit: class Octokit {} }));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({ query: vi.fn(), mutation: vi.fn() }),
}));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: vi.fn().mockResolvedValue({ token: "github-token" }),
}));
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: mocks.setGitHubContext,
  clearGitHubContext: mocks.clearGitHubContext,
}));
vi.mock("@dashboard/lib/notifications-server", () => ({
  mutateNotificationsManifest: mocks.mutateNotificationsManifest,
}));

import {
  createApprovalDecisionDependencies,
  type ClaimedMcpApproval,
} from "@dashboard/lib/mcp/approval-service";

const request: ClaimedMcpApproval = {
  tenantId: "acme/widgets",
  requestId: "request-notification",
  workRecordId: "phase-5",
  targetKind: "automation",
  workflowId: "release-alerts",
  runId: "run-notification",
  mode: "start",
  input: {},
  action: "notification.rule.create",
  approvalId: "approval-notification",
  approvalToken: "private-token",
  actor: {
    tokenId: "token-codex",
    name: "Codex",
    actorLogin: "octocat",
    actorGithubId: 42,
  },
  status: "approving",
};

describe("MCP notification approvals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an approved notification rule without returning its channel secret", async () => {
    mocks.mutateNotificationsManifest.mockImplementation(async (mutator) => {
      const mutation = await mutator({ version: 1, rules: [] });
      return { result: mutation.result, manifest: mutation.next };
    });
    const dependencies = createApprovalDecisionDependencies({
      origin: "https://kody.example",
    });
    const result = await dependencies.dispatchAutomation({
      ...request,
      input: {
        rule: {
          name: "Release alerts",
          enabled: true,
          event: "release_failed",
          channel: {
            type: "generic-webhook",
            url: "https://hooks.example/private-secret",
          },
        },
      },
    });

    expect(result).toEqual({
      automationId: "release-alerts",
      automationKind: "notification-rule",
      operation: "created",
      execution: "kody-online",
    });
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(mocks.clearGitHubContext).toHaveBeenCalledOnce();
  });

  it("deletes an approved notification rule", async () => {
    mocks.mutateNotificationsManifest.mockImplementation(async (mutator) => {
      const mutation = await mutator({
        version: 1,
        rules: [
          {
            id: "release-alerts",
            name: "Release alerts",
            enabled: true,
            event: "release_failed",
            channel: { type: "web-push" },
            createdAt: "2026-09-03T08:00:00.000Z",
          },
        ],
      });
      return { result: mutation.result, manifest: mutation.next };
    });
    const dependencies = createApprovalDecisionDependencies({
      origin: "https://kody.example",
    });

    await expect(
      dependencies.dispatchAutomation({
        ...request,
        action: "notification.rule.delete",
        input: { id: "release-alerts" },
      }),
    ).resolves.toEqual({
      automationId: "release-alerts",
      automationKind: "notification-rule",
      operation: "deleted",
      execution: "kody-online",
    });
  });
});
