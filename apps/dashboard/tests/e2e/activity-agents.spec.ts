/** @testFramework playwright @domain e2e-mocked */
import { expect, test } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

test("Activity Agents shows inspectable runs with nested MCP calls", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      consoleErrors.push(message.text());
  });
  await mockKodyAccountSession(page, {
    id: "activity-agents-e2e",
    name: "Activity Agents E2E",
  });
  await page.addInitScript(() => {
    const repo = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "octocat", id: 1 },
      addedAt: Date.now(),
      isLogin: true,
    };
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        ...repo,
        loggedInAt: Date.now(),
        repos: [repo],
        currentRepoIndex: 0,
      }),
    );
  });
  await page.route(/\/api\/kody\/activity\/agents(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        computedAt: "2026-09-02T12:05:00.000Z",
        runs: [
          {
            runId: "run-codex-1",
            agentName: "Codex",
            clientName: "codex",
            repository: "test-owner/test-repo",
            workRecordId: "shared-activity-1",
            workTitle: "Make agent activity inspectable",
            startedAt: "2026-09-02T12:00:00.000Z",
            endedAt: "2026-09-02T12:04:00.000Z",
            lastActivityAt: "2026-09-02T12:04:00.000Z",
            status: "completed",
            summary: "Activity Agents is live.",
            result: "completed",
            callCount: 2,
            evidence: [
              {
                kind: "test",
                reference: "live:activity-agents",
                summary: "Production browser journey passed",
                recordedAt: "2026-09-02T12:03:00.000Z",
              },
            ],
            handoff: {
              toAgent: "Claude Code",
              summary: "Continue from the verified run",
              nextSteps: ["Review Activity"],
              recordedAt: "2026-09-02T12:04:00.000Z",
            },
            approvals: [
              {
                requestId: "approval-request-1",
                workRecordId: "shared-activity-1",
                targetKind: "workflow",
                workflowId: "quality-run",
                executionRunId: "workflow-run-1",
                mode: "start",
                status: "dispatched",
                createdAt: "2026-09-02T12:01:00.000Z",
                decidedAt: "2026-09-02T12:02:00.000Z",
                decidedBy: "octocat",
                updatedAt: "2026-09-02T12:03:00.000Z",
                execution: {
                  status: "done",
                  updatedAt: "2026-09-02T12:04:00.000Z",
                  url: "https://github.com/test-owner/test-repo/actions/runs/42",
                },
              },
            ],
            calls: [
              {
                eventId: "call-1",
                toolName: "kody_execute_tool",
                actionId: "work.create",
                outcome: "success",
                occurredAt: "2026-09-02T12:00:00.000Z",
              },
              {
                eventId: "call-2",
                toolName: "kody_execute_tool",
                actionId: "work.handoff.create",
                outcome: "success",
                occurredAt: "2026-09-02T12:04:00.000Z",
              },
            ],
          },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/activity", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [],
        total: 0,
        signals: {},
        alert: { level: "ok", message: "No engine issues" },
        computedAt: "2026-09-02T12:05:00.000Z",
      }),
    }),
  );
  await page.route("**/api/kody/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        level: "ok",
        signals: [],
        computedAt: "2026-09-02T12:05:00.000Z",
      }),
    }),
  );

  await page.goto("/repo/test-owner/test-repo/activity/agents/run-codex-1");
  await expect(
    page.getByRole("heading", { name: "Activity", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Agents" })).toBeVisible();
  await expect(page.getByText("Codex", { exact: true }).last()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make agent activity inspectable" }),
  ).toBeVisible();
  await expect(page.getByText("Activity Agents is live.")).toBeVisible();
  await expect(page.getByText("work.create", { exact: true })).toBeVisible();
  await expect(
    page.getByText("work.handoff.create", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Approval requested", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Approved by octocat", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Workflow completed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Todo" }).first(),
  ).toHaveAttribute(
    "href",
    "/repo/test-owner/test-repo/todos/shared-activity-1",
  );
  await expect(
    page.getByRole("link", { name: "Open workflow run" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/test-owner/test-repo/actions/runs/42",
  );
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Handoff" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Todo" }).last(),
  ).toHaveAttribute(
    "href",
    "/repo/test-owner/test-repo/todos/shared-activity-1",
  );
  await expect(page.getByText(/transcript/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
