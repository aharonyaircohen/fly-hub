import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveLiveGitHubUser } from "./live-test";
import {
  establishLiveKodyAccountSession,
  loadLiveKodyAccountCredentialsFromDashboard,
} from "./live-account-session";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
const CONVEX_URL = process.env.CONVEX_URL ?? "";
const CLEANUP_CONVEX_URL = process.env.E2E_CONVEX_URL ?? CONVEX_URL;
const SERVICE_KEY = process.env.KODY_SERVICE_KEY ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("shows a real MCP agent run and its inspectable calls", async ({
  page,
}) => {
  test.setTimeout(420_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO || !CONVEX_URL || !SERVICE_KEY,
    "Requires live Dashboard, repository, and Convex credentials",
  );
  const { owner, repo } = parseRepo(TEST_REPO);
  const repository = `${owner}/${repo}`;
  const dashboardHeaders = {
    "content-type": "application/json",
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  if (process.env.MOCK_KODY_ACCOUNT_SESSION === "1") {
    await mockDashboardShellRequests(page);
  } else {
    await establishLiveKodyAccountSession(
      page.request,
      BASE_URL,
      await loadLiveKodyAccountCredentialsFromDashboard(
        page.request,
        BASE_URL,
        process.env,
      ),
    );
  }
  const user = await resolveLiveGitHubUser(page, BASE_URL, dashboardHeaders);
  await page
    .context()
    .addInitScript(
      ({ auth }) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
      {
        auth: {
          repoUrl: TEST_REPO,
          owner,
          repo,
          token: TEST_TOKEN,
          user,
          loggedInAt: Date.now(),
        },
      },
    );

  const recordId = `activity-ui-${randomUUID()}`;
  let tokenId = "";
  let runId = "";
  let approvalRequestId = "";
  const backend = createBackendClient(CLEANUP_CONVEX_URL);

  try {
    const issued = await page.request.post(`${BASE_URL}/api/kody/mcp/tokens`, {
      headers: dashboardHeaders,
      data: { name: "Codex Activity UI", expiresInDays: 1 },
    });
    expect(issued.status()).toBe(201);
    const issuedBody = await issued.json();
    tokenId = issuedBody.token.tokenId;
    const accessToken = issuedBody.accessToken as string;

    const initialized = await page.request.post(`${BASE_URL}/api/kody/mcp`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "codex", version: "live-test" },
        },
      },
    });
    expect(initialized.status()).toBe(200);
    runId = initialized.headers()["mcp-session-id"] ?? "";
    expect(runId).toMatch(/^run-/);

    const call = async (
      actionId: string,
      input: Record<string, unknown>,
      idempotencyKey: string,
    ) => {
      const response = await page.request.post(`${BASE_URL}/api/kody/mcp`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "mcp-session-id": runId,
        },
        data: {
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: {
            name: "kody_execute_tool",
            arguments: { actionId, input, idempotencyKey },
          },
        },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.result.isError).toBe(false);
      return body.result.structuredContent;
    };

    await call(
      "work.create",
      {
        recordId,
        title: "Live agent activity",
        objective: "Prove Kody exposes agent work without a private transcript",
        summary: "Codex completed the inspectable Activity run.",
        tasks: ["Record calls", "Show evidence", "Show the handoff"],
      },
      `create-${recordId}`,
    );
    await call(
      "work.evidence.add",
      {
        recordId,
        expectedRevision: 1,
        kind: "test",
        reference: "live:activity-agents",
        summary: "The real MCP call was recorded and rendered",
      },
      `evidence-${recordId}`,
    );
    await call(
      "work.handoff.create",
      {
        recordId,
        expectedRevision: 2,
        toAgent: "OpenCode",
        summary: "Continue from this verified Kody run",
        nextSteps: ["Inspect the Activity timeline"],
      },
      `handoff-${recordId}`,
    );
    const workflows = (await call(
      "workflow.list",
      {},
      `workflows-${recordId}`,
    )) as Array<{ id?: string }>;
    const workflowId =
      process.env.E2E_ACTIVITY_WORKFLOW_ID?.trim() || "director-ci-monitor";
    expect(workflows.some((workflow) => workflow.id === workflowId)).toBe(true);
    const approval = await call(
      "workflow.run.request",
      { workRecordId: recordId, workflowId, input: {} },
      `request-workflow-${recordId}`,
    );
    approvalRequestId = approval.requestId;
    expect(approval.status).toBe("pending");
    const closed = await page.request.delete(`${BASE_URL}/api/kody/mcp`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "mcp-session-id": runId,
      },
    });
    expect(closed.status()).toBe(204);

    await page.goto(
      `${BASE_URL}/repo/${owner}/${repo}/activity/agents/${runId}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", { name: "Live agent activity" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("article").getByText("Codex Activity UI", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("work.create", { exact: true })).toBeVisible();
    await expect(
      page.getByText("work.evidence.add", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("work.handoff.create", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The real MCP call was recorded and rendered"),
    ).toBeVisible();
    await expect(
      page.getByText("Continue from this verified Kody run"),
    ).toBeVisible();
    await expect(
      page.getByText("Approval requested", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Approved by /, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("Workflow dispatched", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open Todo" }).first(),
    ).toHaveAttribute("href", `/repo/${owner}/${repo}/todos/${recordId}`);
    await expect(
      page.getByRole("link", { name: "Open workflow" }),
    ).toHaveAttribute("href", `/repo/${owner}/${repo}/workflows/${workflowId}`);
    if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(BASE_URL)) {
      await expect
        .poll(
          async () => {
            await page.reload({ waitUntil: "domcontentloaded" });
            const workflowRunLink = page.getByRole("link", {
              name: "Open workflow run",
            });
            try {
              await workflowRunLink.waitFor({
                state: "visible",
                timeout: 8_000,
              });
              return await workflowRunLink.count();
            } catch {
              return 0;
            }
          },
          { timeout: 300_000, intervals: [10_000, 15_000] },
        )
        .toBe(1);
      await expect(
        page.getByRole("link", { name: "Open workflow run" }),
      ).toHaveAttribute(
        "href",
        new RegExp(`^https://github\\.com/${owner}/${repo}/actions/runs/\\d+$`),
      );
    }
    await expect(
      page.getByRole("link", { name: "Open Todo" }).last(),
    ).toHaveAttribute("href", `/repo/${owner}/${repo}/todos/${recordId}`);
    await expect(page.getByText(/transcript/i)).toHaveCount(0);

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/todos/${recordId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Live agent activity" }),
    ).toBeVisible({ timeout: 30_000 });
    const todoArticle = page.getByRole("article");
    const recordCalls = todoArticle.getByRole("heading", {
      name: "Record calls",
      exact: true,
    });
    await recordCalls.scrollIntoViewIfNeeded();
    await expect(recordCalls).toBeVisible();
    const evidenceItem = todoArticle.getByRole("heading", {
      name: "Evidence: The real MCP call was recorded and rendered",
      exact: true,
    });
    await evidenceItem.scrollIntoViewIfNeeded();
    await expect(evidenceItem).toBeVisible();
    const handoffItem = todoArticle.getByRole("heading", {
      name: "Handoff to OpenCode: Continue from this verified Kody run",
      exact: true,
    });
    await handoffItem.scrollIntoViewIfNeeded();
    await expect(handoffItem).toBeVisible();
  } finally {
    if (approvalRequestId)
      await backend.mutation(backendApi.mcpApprovalRequests.remove, {
        tenantId: repository,
        requestId: approvalRequestId,
      });
    if (runId)
      await backend.mutation(backendApi.agentRuns.remove, {
        tenantId: repository,
        runId,
      });
    await backend.mutation(backendApi.repoDocs.remove, {
      tenantId: repository,
      kind: `todo:${recordId}`,
    });
    if (tokenId)
      await page.request.delete(`${BASE_URL}/api/kody/mcp/tokens`, {
        headers: dashboardHeaders,
        data: { tokenId },
      });
  }
});
