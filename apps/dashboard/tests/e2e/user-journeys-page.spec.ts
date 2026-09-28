import { expect, test, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

const journey = {
  slug: "create-workflow",
  name: "Create a workflow",
  goal: "A user can create and review a workflow.",
  status: "active",
  priority: "critical",
  actionSlugs: [],
  updatedAt: new Date().toISOString(),
};

const qualityMap = (journeys: unknown[]) => ({
  actions: [],
  journeys,
  scenarios: [],
  runs: [],
  currentSourceCommit: null,
});

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
});

test("shows a repository journey in the Quality workspace", async ({
  page,
}) => {
  const methods: string[] = [];
  await page.route("**/api/kody/quality/journeys**", async (route) => {
    methods.push(route.request().method());
    await json(route, qualityMap([journey]));
  });

  await page.goto("/repo/acme/widgets/quality/journeys", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Journeys" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Create a workflow", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("critical", { exact: true })).toBeVisible();
  expect(methods).toEqual(["GET"]);
});

test("creates a journey from the page", async ({ page }) => {
  let saved = false;
  let savedJourney: unknown = null;
  await page.route("**/api/kody/quality/journeys**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, qualityMap(saved ? [savedJourney] : []));
      return;
    }
    saved = true;
    savedJourney = route.request().postDataJSON();
    await json(route, { ok: true }, 201);
  });

  await page.goto("/repo/acme/widgets/quality/journeys", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Journeys" })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .locator("header")
    .filter({ has: page.getByRole("heading", { name: "Journeys", exact: true }) })
    .getByRole("button", { name: "New journey", exact: true })
    .click();
  await page.getByLabel("Name").fill("Review a workflow");
  await page
    .getByRole("textbox", { name: "Goal" })
    .fill("A user can review a workflow.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review a workflow" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    /\/repo\/acme\/widgets\/quality\/journeys\/review-a-workflow$/,
  );
});
