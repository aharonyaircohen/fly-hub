/**
 * Integration tests for the GitHub webhook receiver
 * (app/api/webhooks/github/route.ts). This route is the backbone of the
 * push-based cache-invalidation architecture that replaced polling — if it
 * stops invalidating, the dashboard silently serves stale data until TTL,
 * and if it stops rejecting non-GitHub IPs it accepts spoofed events. It
 * had no test.
 *
 * The route calls invalidate* + dispatch helpers directly (not HTTP), so we
 * mock those seams and the IP verifier, then drive the handler with real
 * NextRequests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const gh = vi.hoisted(() => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
  invalidateBranchCache: vi.fn(),
  invalidateWorkflowCache: vi.fn(),
  invalidatePRBehindCache: vi.fn(),
  invalidateDiscussionCache: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
const workflow = vi.hoisted(() => ({
  dispatchGitHubWorkflowTriggers: vi.fn(async () => {}),
}));
const background = vi.hoisted(() => ({
  resolveBackgroundToken: vi.fn(async () => ({
    token: "background-token",
    source: "app",
  })),
  createUserOctokit: vi.fn(() => ({}) as never),
}));
const deliveryHealth = vi.hoisted(() => ({
  recordWebhookDelivery: vi.fn(async () => {}),
}));
const ipv = vi.hoisted(() => ({
  getClientIp: vi.fn(() => "140.82.115.42"),
  isFromGitHub: vi.fn(async () => true),
}));
const side = vi.hoisted(() => ({
  dispatchNotifications: vi.fn(async () => {}),
  dispatchMentionPushes: vi.fn(async () => {}),
  dispatchAgentMentions: vi.fn(async () => {}),
  applyVerdictFromComment: vi.fn(async () => {}),
  handlePrMerged: vi.fn(async () => {}),
  handleReleasePublished: vi.fn(async () => {}),
  handlePreviewDefaultBranchPush: vi.fn(async () => {}),
  handlePreviewPrClosed: vi.fn(async () => {}),
  handlePreviewPrOpenedOrSynced: vi.fn(async () => {}),
  handlePreviewTrackedBranchPush: vi.fn(async () => {}),
}));

vi.mock("@dashboard/lib/github-client", () => gh);
vi.mock("@dashboard/lib/webhooks/github-ip", () => ipv);
vi.mock("@dashboard/lib/webhooks/delivery-store", () => ({
  recordWebhookDelivery: deliveryHealth.recordWebhookDelivery,
}));
vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@kody-ade/base/auth/background-token", () => ({
  resolveBackgroundToken: background.resolveBackgroundToken,
}));
vi.mock("@kody-ade/base/github/core", async () => {
  const actual = await vi.importActual<
    typeof import("@kody-ade/base/github/core")
  >("@kody-ade/base/github/core");
  return { ...actual, createUserOctokit: background.createUserOctokit };
});
vi.mock("@dashboard/lib/notifications-dispatch", () => ({
  dispatchNotifications: side.dispatchNotifications,
}));
vi.mock("@dashboard/lib/push/mention-dispatch", () => ({
  dispatchMentionPushes: side.dispatchMentionPushes,
}));
vi.mock("@dashboard/lib/push/agent-mention-dispatch", () => ({
  dispatchAgentMentions: side.dispatchAgentMentions,
}));
vi.mock("@dashboard/lib/ui-verify/apply-label", () => ({
  applyVerdictFromComment: side.applyVerdictFromComment,
}));
vi.mock("@dashboard/lib/changelog/handlers", () => ({
  handlePrMerged: side.handlePrMerged,
  handleReleasePublished: side.handleReleasePublished,
}));
vi.mock("@kody-ade/fly/previews/webhook", () => ({
  handleDefaultBranchPush: side.handlePreviewDefaultBranchPush,
  handlePrClosed: side.handlePreviewPrClosed,
  handlePrOpenedOrSynced: side.handlePreviewPrOpenedOrSynced,
  handleTrackedBranchPush: side.handlePreviewTrackedBranchPush,
}));
vi.mock(
  "@dashboard/features/workflows/server/github-workflow-trigger-dispatch",
  () => workflow,
);

import { POST } from "../../app/api/webhooks/github/route";

let deliveryCounter = 0;
function makeReq(
  event: string,
  payload: unknown,
  opts: { delivery?: string; rawBody?: string; signature?: string } = {},
) {
  const delivery = opts.delivery ?? `delivery-${++deliveryCounter}`;
  const rawBody = opts.rawBody ?? JSON.stringify(payload);
  return new NextRequest("https://dash.test/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": delivery,
      ...(opts.signature ? { "x-hub-signature-256": opts.signature } : {}),
    },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  ipv.getClientIp.mockReturnValue("140.82.115.42");
  ipv.isFromGitHub.mockResolvedValue(true);
});

function signatureFor(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

describe("POST /api/webhooks/github — auth", () => {
  it("rejects with 403 when the source IP is not GitHub's", async () => {
    ipv.isFromGitHub.mockResolvedValue(false);
    const res = await POST(makeReq("issues", { issue: { number: 1 } }));
    expect(res.status).toBe(403);
    expect(gh.invalidateIssueCache).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    const res = await POST(makeReq("issues", null, { rawBody: "{ not json" }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid HMAC signature when a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "hook-secret");
    const rawBody = JSON.stringify({ issue: { number: 1 } });

    const res = await POST(
      makeReq("issues", null, {
        rawBody,
        signature: signatureFor(rawBody, "hook-secret"),
      }),
    );

    expect(res.status).toBe(200);
    expect(ipv.isFromGitHub).not.toHaveBeenCalled();
    expect(gh.invalidateIssueCache).toHaveBeenCalledWith(1);
  });

  it("rejects missing or invalid HMAC signatures when a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "hook-secret");

    const missing = await POST(makeReq("issues", { issue: { number: 1 } }));
    expect(missing.status).toBe(403);

    const bad = await POST(
      makeReq("issues", { issue: { number: 1 } }, { signature: "sha256=00" }),
    );
    expect(bad.status).toBe(403);
    expect(gh.invalidateIssueCache).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/github — invalidation routing", () => {
  it("issues → invalidates that issue's cache", async () => {
    const res = await POST(makeReq("issues", { issue: { number: 123 } }));
    expect(res.status).toBe(200);
    expect(gh.invalidateIssueCache).toHaveBeenCalledWith(123);
  });

  it("push → invalidates branch + PR-behind caches", async () => {
    await POST(makeReq("push", { ref: "refs/heads/main" }));
    expect(gh.invalidateBranchCache).toHaveBeenCalledTimes(1);
    expect(gh.invalidatePRBehindCache).toHaveBeenCalledTimes(1);
  });

  it("push → asks previews to rebuild a tracked branch preview", async () => {
    await POST(
      makeReq("push", {
        ref: "refs/heads/dev",
        after: "new-head-sha",
        head_commit: {
          id: "new-head-sha",
          added: ["src/new.ts"],
          modified: ["src/app.tsx"],
          removed: [],
        },
        repository: {
          full_name: "acme/widgets",
          default_branch: "dev",
        },
      }),
    );

    expect(side.handlePreviewTrackedBranchPush).toHaveBeenCalledWith({
      repoFullName: "acme/widgets",
      branch: "dev",
      ref: "new-head-sha",
      changedPaths: ["src/new.ts", "src/app.tsx"],
    });
  });

  it("workflow_run → invalidates the workflow cache", async () => {
    await POST(makeReq("workflow_run", { action: "completed" }));
    expect(gh.invalidateWorkflowCache).toHaveBeenCalledTimes(1);
  });

  it("unknown event → 200 but handled:false", async () => {
    const res = await POST(makeReq("membership", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handled: false });
  });
});

describe("POST /api/webhooks/github — side effects", () => {
  it("records an authenticated repository delivery for health checks", async () => {
    await POST(
      makeReq(
        "issue_comment",
        {
          action: "created",
          repository: { full_name: "acme/widgets" },
          issue: { number: 5 },
        },
        { delivery: "delivery-health-1" },
      ),
    );

    expect(deliveryHealth.recordWebhookDelivery).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      deliveryId: "delivery-health-1",
      event: "issue_comment",
    });
  });

  it("passes a completed workflow run to configured Workflow triggers", async () => {
    await POST(
      makeReq("workflow_run", {
        action: "completed",
        workflow_run: { id: 77, run_attempt: 2, conclusion: "failure" },
        repository: { full_name: "acme/widgets" },
      }),
    );
    expect(workflow.dispatchGitHubWorkflowTriggers).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: expect.stringMatching(/^delivery-/),
        event: expect.objectContaining({
          name: "github.workflow_run.completed",
          brand: { owner: "acme", repo: "widgets" },
          payload: expect.objectContaining({
            runId: 77,
            runAttempt: 2,
            conclusion: "failure",
          }),
        }),
      }),
    );
    expect(gh.setGitHubContext).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "background-token",
    );
    expect(gh.clearGitHubContext).toHaveBeenCalledTimes(1);
  });

  it("keeps the webhook successful when configured workflow dispatch fails", async () => {
    workflow.dispatchGitHubWorkflowTriggers.mockRejectedValueOnce(
      new Error("workflow backend unavailable"),
    );

    const response = await POST(
      makeReq("workflow_run", {
        action: "completed",
        workflow_run: { id: 78, conclusion: "failure" },
        repository: { full_name: "acme/widgets" },
      }),
    );

    expect(response.status).toBe(200);
    expect(gh.invalidateWorkflowCache).toHaveBeenCalledTimes(1);
    expect(gh.clearGitHubContext).toHaveBeenCalledTimes(1);
  });

  it("ACKs before a slow configured workflow dispatch finishes", async () => {
    let finishDispatch!: () => void;
    workflow.dispatchGitHubWorkflowTriggers.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDispatch = resolve)),
    );

    const response = await POST(
      makeReq("workflow_run", {
        action: "completed",
        workflow_run: { id: 79, conclusion: "success" },
        repository: { full_name: "acme/widgets" },
      }),
    );

    expect(response.status).toBe(200);
    expect(workflow.dispatchGitHubWorkflowTriggers).toHaveBeenCalledTimes(1);
    finishDispatch();
  });

  it("appends a changelog entry when a PR is merged", async () => {
    await POST(
      makeReq("pull_request", {
        action: "closed",
        pull_request: { number: 7, merged: true },
      }),
    );
    expect(gh.invalidatePRCache).toHaveBeenCalled();
    expect(side.handlePrMerged).toHaveBeenCalledTimes(1);
  });

  it("does NOT append a changelog entry when a PR is closed unmerged", async () => {
    await POST(
      makeReq("pull_request", {
        action: "closed",
        pull_request: { number: 8, merged: false },
      }),
    );
    expect(side.handlePrMerged).not.toHaveBeenCalled();
  });

  it("waits for preview cleanup before ACKing a closed PR", async () => {
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    side.handlePreviewPrClosed.mockImplementationOnce(async () => cleanup);

    const response = POST(
      makeReq("pull_request", {
        action: "closed",
        repository: { full_name: "acme/widgets" },
        pull_request: { number: 8, merged: false },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(side.handlePreviewPrClosed).toHaveBeenCalledWith({
      repoFullName: "acme/widgets",
      prNumber: 8,
    });

    let settled = false;
    response.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCleanup();
    expect((await response).status).toBe(200);
  });

  it("applies a verdict label on a new PR comment carrying a Verdict marker", async () => {
    await POST(
      makeReq("issue_comment", {
        action: "created",
        issue: { number: 9, pull_request: {} },
        comment: { body: "Verdict: approve", user: { login: "alice" } },
      }),
    );
    expect(side.applyVerdictFromComment).toHaveBeenCalledWith(
      9,
      expect.stringContaining("Verdict"),
    );
  });

  it("fans the payload out to notifications + mention + agent dispatch", async () => {
    await POST(makeReq("issues", { issue: { number: 5 } }));
    expect(side.dispatchNotifications).toHaveBeenCalledTimes(1);
    expect(side.dispatchMentionPushes).toHaveBeenCalledTimes(1);
    expect(side.dispatchAgentMentions).toHaveBeenCalledTimes(1);
  });

  it("waits for preview base rebuild dispatch before ACKing a default-branch push", async () => {
    let resolveBase!: () => void;
    side.handlePreviewDefaultBranchPush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBase = resolve;
        }),
    );

    let settled = false;
    const pending = POST(
      makeReq("push", {
        ref: "refs/heads/dev",
        after: "new-head-sha",
        head_commit: {
          id: "new-head-sha",
          added: [],
          modified: ["src/app.tsx"],
          removed: [],
        },
        repository: {
          full_name: "acme/widgets",
          default_branch: "dev",
        },
      }),
    ).then((res) => {
      settled = true;
      return res;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    resolveBase();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(side.handlePreviewDefaultBranchPush).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/webhooks/github — delivery dedup", () => {
  it("processes a delivery once and short-circuits the redelivery", async () => {
    const first = await POST(
      makeReq("issues", { issue: { number: 42 } }, { delivery: "dup-1" }),
    );
    expect(first.status).toBe(200);
    expect(gh.invalidateIssueCache).toHaveBeenCalledTimes(1);

    const second = await POST(
      makeReq("issues", { issue: { number: 42 } }, { delivery: "dup-1" }),
    );
    expect(await second.json()).toMatchObject({ ok: true, dedup: true });
    // The redelivery must NOT trigger a second invalidation.
    expect(gh.invalidateIssueCache).toHaveBeenCalledTimes(1);
  });
});
