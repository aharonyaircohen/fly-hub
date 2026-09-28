/**
 * @fileoverview Regression coverage for repo Dashboard navigation.
 * @testFramework playwright
 * @domain routing
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const OWNER = "test-owner";
const REPO = "test-repo";

async function seedRepoAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "ghp_placeholder",
          user: {
            login: "navigation-e2e",
            avatar_url: "https://github.com/github.png",
            id: 1,
          },
          loggedInAt: Date.now(),
          repos: [
            {
              repoUrl: `https://github.com/${owner}/${repo}`,
              owner,
              repo,
              token: "ghp_placeholder",
              addedAt: Date.now(),
              isLogin: true,
              user: {
                login: "navigation-e2e",
                avatar_url: "https://github.com/github.png",
                id: 1,
              },
            },
          ],
          currentRepoIndex: 0,
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );

  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          login: "navigation-e2e",
          avatar_url: "https://github.com/github.png",
          githubId: 1,
        },
      }),
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    }),
  );
  await page.route("**/api/kody/commands", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ commands: [] }),
    }),
  );
  await page.route("**/api/kody/tasks**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tasks: [], counts: {} }),
    }),
  );
}

test("Dashboard navigation keeps the current browser document alive", async ({
  page,
}) => {
  await seedRepoAuth(page);
  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/tasks`);

  const dashboardLink = page.getByRole("link", {
    name: "Dashboard",
    exact: true,
  });
  await expect(dashboardLink).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    Object.assign(window, { __kodySoftNavigationMarker: "preserved" });
  });
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequests.push(request.url());
    }
  });

  await dashboardLink.click();

  await expect(page).toHaveURL(new RegExp(`/repo/${OWNER}/${REPO}/?$`));
  expect(documentRequests).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __kodySoftNavigationMarker?: string })
            .__kodySoftNavigationMarker,
      ),
    )
    .toBe("preserved");
});
