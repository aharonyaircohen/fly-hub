import { expect, test, type Route } from "@playwright/test";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (value) => window.localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/company/backend/info", (route) =>
    json(route, {
      convexHost: "demo.convex.cloud",
      configured: true,
      databaseTier: "dev",
      runtimeEnv: "test",
    }),
  );
});

test("keeps backend export under the selected repository", async ({ page }) => {
  let exportRepo: string | null = null;
  await page.route("**/api/kody/company/backend/export", async (route) => {
    const request = route.request();
    exportRepo = `${request.headers()["x-kody-owner"]}/${request.headers()["x-kody-repo"]}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Content-Disposition":
          'attachment; filename="backend-export-acme-widgets.json"',
      },
      body: JSON.stringify({
        version: 1,
        tenantId: "acme/widgets",
        tables: {},
      }),
    });
  });

  await page.goto("/repo/acme/widgets/backend", {
    waitUntil: "domcontentloaded",
  });

  await expect(page).toHaveURL(/\/repo\/acme\/widgets\/backend$/);
  await expect(
    page.getByRole("heading", { name: "Backend", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("acme/widgets", { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export (backup from database)" })
    .click();
  await download;

  expect(exportRepo).toBe("acme/widgets");
});
