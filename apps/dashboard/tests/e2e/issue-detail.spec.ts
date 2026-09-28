/**
 * @fileoverview Deterministic browser journeys for the primary task-detail
 * surface. The canonical gate must not depend on a particular live repository
 * happening to contain a visible issue.
 */

import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const OWNER = "test-owner";
const REPO = "test-repo";
const ISSUE_NUMBER = 4242;
const ISSUE_TITLE = "E2E task detail fixture";

const task = {
  id: String(ISSUE_NUMBER),
  issueNumber: ISSUE_NUMBER,
  title: ISSUE_TITLE,
  body: "A deterministic issue used by the browser gate.",
  state: "open",
  labels: [] as string[],
  column: "building",
  kodyPhase: null,
  kodyFlow: null,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

async function seedAuthenticatedFixture(
  page: Page,
  fixtureTask = task,
): Promise<void> {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "ghp_placeholder",
          user: { login: "issue-detail-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/tasks/issue-4242**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        task: fixtureTask,
        assignees: [],
        comments: [],
      }),
    }),
  );
  await page.route("**/api/kody/tasks**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tasks: [fixtureTask],
        counts: { history: fixtureTask.state === "closed" ? 1 : 0 },
      }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ conversations: [] }),
    }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        owner: OWNER,
        repo: REPO,
        user: { login: "issue-detail-e2e", avatar_url: "", id: 1 },
      }),
    }),
  );
}

test.describe("Issue detail flow", () => {
  test.beforeEach(async ({ page }) => seedAuthenticatedFixture(page));

  test("board card opens the issue detail page", async ({ page }) => {
    await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/tasks`);

    const taskCard = page.getByText(ISSUE_TITLE, { exact: true });
    await expect(taskCard).toBeVisible({ timeout: 15_000 });
    await taskCard.click();

    await expect(page).toHaveURL(new RegExp(`/${ISSUE_NUMBER}$`));
    await expect(
      page.getByText(ISSUE_TITLE, { exact: true }).first(),
    ).toBeVisible();
  });

  test("issue comments sub-route renders", async ({ page }) => {
    await page.goto(
      `${BASE_URL}/repo/${OWNER}/${REPO}/${ISSUE_NUMBER}/comments`,
    );

    await expect(
      page.getByText(ISSUE_TITLE, { exact: true }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("tab", { name: /Comments/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#task-panel-comments:visible")).toBeVisible();
  });

  test("task-scoped chat can open and close conversation history", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/${ISSUE_NUMBER}`);

    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await expect(
      chat.getByPlaceholder(`Ask about task #${ISSUE_NUMBER}...`),
    ).toBeVisible();

    const toggle = chat.getByRole("button", { name: "Toggle conversations" });
    await toggle.click();

    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "Close conversations" }).click();
    await expect(sidebar).toBeHidden();
  });
});

test("history shows a closed unfinished task as closed, not completed", async ({
  page,
}) => {
  await seedAuthenticatedFixture(page, {
    ...task,
    state: "closed",
    column: "open",
    labels: ["kody:building"],
  });

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/tasks?view=history`);

  await expect(page.getByRole("button", { name: "History (1)" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toHaveCount(0);

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/${ISSUE_NUMBER}`);
  await expect(page.getByText("Closed", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toHaveCount(0);
});
