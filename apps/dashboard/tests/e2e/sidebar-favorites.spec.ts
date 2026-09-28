import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "test-owner";
const REPO = "test-repo";
const CANONICAL_TASKS_URL = `/repo/${OWNER}/${REPO}/tasks`;

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "favorites-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
  });
}

test("user can favorite a page and keep it after reload", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  let storedFavoriteHrefs: string[] = [];
  const completedSavedBodies: unknown[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`${message.location().url}: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith("/api/kody/navigation-favorites")
    ) {
      return;
    }
    if (
      request.method() === "GET" &&
      request.url().endsWith("/api/kody/chat/machines") &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      return;
    }
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await seedAuth(page);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/navigation-favorites", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        favoriteHrefs: string[];
      };
      storedFavoriteHrefs = body.favoriteHrefs;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ favoriteHrefs: storedFavoriteHrefs }),
      });
      completedSavedBodies.push(body);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ favoriteHrefs: storedFavoriteHrefs }),
    });
  });
  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: { login: "favorites-e2e", avatar_url: "", githubId: 1 },
        owner: OWNER,
        repo: REPO,
      }),
    }),
  );
  await page.route("**/api/kody/agents", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agent: [] }),
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    }),
  );
  await page.route("**/api/kody/brain/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    }),
  );
  await page.route("**/api/kody/chat/machines", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ local: false }),
    }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ flows: [] }),
    }),
  );
  await page.route("**/api/kody/commands", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ commands: [] }),
    }),
  );
  await page.route("**/api/kody/dashboard-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ config: {} }),
    }),
  );
  await page.route("**/api/kody/system-events", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    }),
  );
  await page.route("**/api/kody/secrets**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        new URL(route.request().url()).pathname.endsWith("/FLY_API_TOKEN/value")
          ? { exists: false }
          : { secrets: [] },
      ),
    }),
  );
  await page.route("**/api/kody/cms**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          configured: true,
          collections: [
            { name: "posts", label: "Posts" },
            { name: "users", label: "Users" },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/kody/file-spaces", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ spaces: [] }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return route.fulfill({
      status: request.method() === "POST" && isCollection ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        request.method() === "GET" && isCollection
          ? { conversations: [] }
          : { ok: true },
      ),
    });
  });
  await page.route("**/api/kody/tasks**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tasks: [], counts: {} }),
    }),
  );
  await page.route("**/api/kody/collaborators", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ collaborators: [] }),
    }),
  );
  await page.route("**/api/kody/ci/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [] }),
    }),
  );
  await page.route("**/api/kody/boards", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ boards: [] }),
    }),
  );
  await page.goto(CANONICAL_TASKS_URL);
  const navigation = page.getByRole("complementary", {
    name: "Primary navigation",
  });
  const sidebar = page.locator('aside[aria-label="Primary navigation"]');
  await expect(navigation).toBeVisible();

  const navigationSearch = navigation.getByRole("searchbox", {
    name: "Search navigation",
  });
  const expandedRepoSwitcher = navigation.getByTitle("Switch repository");
  const firstRepositorySection = navigation.getByRole("button", {
    name: "Work",
    exact: true,
  });
  await expect(navigationSearch).toBeVisible();
  await expect(expandedRepoSwitcher).toBeVisible();
  await expect(firstRepositorySection).toBeVisible();
  expect(
    await navigationSearch.evaluate((search, switcherTitle) => {
      const switcher = document.querySelector(`[title="${switcherTitle}"]`);
      const repository = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "Work",
      );
      return Boolean(
        switcher &&
        repository &&
        search.compareDocumentPosition(switcher) &
          Node.DOCUMENT_POSITION_FOLLOWING &&
        switcher.compareDocumentPosition(repository) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }, "Switch repository"),
  ).toBe(true);

  const saveFavorite = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/kody/navigation-favorites") &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await navigation
    .getByRole("button", { name: "Add Tasks to favorites" })
    .click();
  await saveFavorite;

  const favorites = navigation.getByRole("region", {
    name: "Favorite pages",
  });
  await expect(favorites).toBeVisible();
  await expect(favorites.getByText("Favorites", { exact: true })).toHaveCount(
    0,
  );
  await expect(favorites.getByRole("link", { name: "Tasks" })).toBeVisible();
  await expect
    .poll(() => completedSavedBodies)
    .toContainEqual({
      favoriteHrefs: ["/tasks"],
    });

  await page.waitForLoadState("networkidle");
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    navigation.getByRole("region", { name: "Favorite pages" }),
  ).toBeVisible();

  const removeFavorite = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/kody/navigation-favorites") &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await favorites
    .getByRole("button", { name: "Remove Tasks from favorites" })
    .click();
  await removeFavorite;
  await expect(favorites).toHaveCount(0);
  await expect
    .poll(() => completedSavedBodies)
    .toContainEqual({
      favoriteHrefs: [],
    });

  await navigation
    .getByRole("button", { name: "Content", exact: true })
    .click();
  await expect(
    navigation.getByRole("link", { name: "Entries", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Posts", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Users", exact: true }),
  ).toHaveCount(0);

  await navigation
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(
    navigation.getByRole("button", { name: "Work", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Tasks", exact: true }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: /^Notifications/ }),
  ).toBeVisible();
  const repoSwitcher = navigation.getByTitle("Switch repository");
  await expect(repoSwitcher).toBeVisible();
  await repoSwitcher.click();
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(
    page.getByRole("listbox", { name: "Connected repositories" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const reportAction = navigation.getByRole("button", {
    name: "Report issue to Kody",
    exact: true,
  });
  const sidebarVersion = sidebar.locator("[data-sidebar-version]");
  await expect(reportAction).toBeVisible();
  await expect(sidebarVersion).toBeVisible();
  expect(
    await reportAction.evaluate((element) => {
      const version = document.querySelector("[data-sidebar-version]");
      return Boolean(
        version &&
        element.compareDocumentPosition(version) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);

  await navigation.getByRole("button", { name: "Search", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  const collapsedSearch = page.getByRole("menu", {
    name: "Search",
    exact: true,
  });
  const collapsedSearchInput = collapsedSearch.getByRole("searchbox", {
    name: "Search navigation",
  });
  await expect(collapsedSearchInput).toBeVisible();
  await collapsedSearchInput.fill("Vibe");
  await expect(
    collapsedSearch.getByRole("menuitem", { name: "Vibe", exact: true }),
  ).toBeVisible();
  await collapsedSearchInput.press("Escape");
  await expect(collapsedSearch).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Work", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  const workPages = page.getByRole("menu", { name: "Work", exact: true });
  await expect(workPages).toBeVisible();
  await expect(
    workPages.getByRole("menuitem", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    workPages.getByRole("menuitem", { name: "Vibe", exact: true }),
  ).toBeVisible();
  await workPages.getByRole("menuitem", { name: "Tasks", exact: true }).click();
  await expect(workPages).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
});
