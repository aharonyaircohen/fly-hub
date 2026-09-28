/** @testFramework playwright @domain e2e-mocked */
import { expect, test, type Page } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

async function seedRepository(page: Page) {
  await page.addInitScript(() => {
    const repo = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "apps-e2e", avatar_url: "", id: 1 },
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
}

test.describe("Apps management", () => {
  test("shows every app through the same management layout", async ({
    page,
  }) => {
    await mockKodyAccountSession(page, { id: "apps-e2e", name: "Apps E2E" });
    await seedRepository(page);
    await page.route("**/api/kody/apps", (route) =>
      route.fulfill({
        json: {
          apps: [
            {
              appId: "managed-browser",
              kind: "browser",
              scope: "repository",
              name: "Browser",
              slug: "browser",
              observedStatus: "idle",
              desiredStatus: "available",
              manageHref: "/preview",
              provider: {},
              updatedAt: new Date().toISOString(),
            },
            {
              appId: "managed-brain",
              kind: "brain",
              scope: "personal",
              name: "Brain",
              slug: "brain",
              observedStatus: "suspended",
              desiredStatus: "available",
              manageHref: "/brain",
              lifecycle: {
                start: "/api/kody/brain/resume",
                stop: "/api/kody/brain/suspend",
              },
              provider: {},
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      }),
    );
    let resumed = false;
    await page.route("**/api/kody/brain/resume", (route) => {
      resumed = true;
      return route.fulfill({ json: { ok: true, status: "running" } });
    });

    await page.goto("/repo/test-owner/test-repo/apps/brain");
    await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: "Personal" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "App actions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open app" }).click();
    await expect.poll(() => resumed).toBe(true);
    await expect(page).toHaveURL(/\/brain$/);

    await page.goto("/repo/test-owner/test-repo/apps/browser");
    await expect(
      page.getByRole("definition").filter({ hasText: "Repository" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Open app" }).click();
    await expect(page).toHaveURL(/\/repo\/test-owner\/test-repo\/preview$/);
  });

  test("switches apps in place without refetching or losing search", async ({
    page,
  }) => {
    await mockKodyAccountSession(page, { id: "apps-e2e", name: "Apps E2E" });
    await seedRepository(page);
    let listRequests = 0;
    await page.route("**/api/kody/apps", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      listRequests += 1;
      return route.fulfill({
        json: {
          apps: [
            {
              appId: "app-one",
              kind: "repository",
              scope: "repository",
              name: "Alpha app",
              slug: "alpha-app",
              repository: "test-owner/test-repo",
              branch: "main",
              rootDirectory: ".",
              observedStatus: "running",
              desiredStatus: "running",
              provider: { publicUrl: "https://alpha.example" },
              updatedAt: new Date().toISOString(),
            },
            {
              appId: "app-two",
              kind: "repository",
              scope: "repository",
              name: "Beta app",
              slug: "beta-app",
              repository: "test-owner/test-repo",
              branch: "main",
              rootDirectory: ".",
              observedStatus: "running",
              desiredStatus: "running",
              provider: { publicUrl: "https://beta.example" },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      });
    });

    await page.goto("/repo/test-owner/test-repo/apps/alpha-app");
    await expect.poll(() => listRequests).toBe(1);
    await page
      .getByRole("searchbox", { name: "Search apps" })
      .pressSequentially("Beta");
    await expect(page.getByRole("button", { name: /Alpha app/ })).toHaveCount(
      0,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          sessionStorage.getItem(
            "kody:apps-search:/repo/test-owner/test-repo/apps",
          ),
        ),
      )
      .toBe("Beta");
    const requestsBeforeSwitch = listRequests;
    await page.getByRole("button", { name: /Beta app/ }).click();

    await expect(page).toHaveURL(/\/apps\/beta-app$/);
    await expect(page.getByRole("heading", { name: "Beta app" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search apps" }),
    ).toHaveValue("Beta");
    expect(listRequests).toBe(requestsBeforeSwitch);

    await page.goBack();
    await expect(page).toHaveURL(/\/apps\/alpha-app$/);
    await expect(
      page.getByRole("heading", { name: "Alpha app" }),
    ).toBeVisible();
  });

  test("manages a selected App and creates a repository app in place", async ({
    page,
  }) => {
    let appStatus = "stopped";
    let created = false;
    let appListRequests = 0;
    await mockKodyAccountSession(page, { id: "apps-e2e", name: "Apps E2E" });
    await seedRepository(page);
    await page.route("**/api/kody/apps", (route) => {
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill({
          status: 202,
          json: {
            appId: "new-app-id",
            slug: "new-service",
            status: "building",
          },
        });
      }
      appListRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          apps: [
            {
              appId: "22222222-2222-4222-8222-222222222222",
              name: "Storefront",
              slug: "storefront",
              repository: "lfnovo/open-notebook",
              branch: "main",
              rootDirectory: "apps/web",
              observedStatus: appStatus,
              desiredStatus: appStatus,
              exposure: "private",
              provider: {
                appName: "kody-app-storefront",
                publicUrl: "https://storefront.fly.dev",
              },
              currentDeploymentId: "33333333-3333-4333-8333-333333333333",
              secretNames: ["DATABASE_URL"],
              accessTokens: [
                {
                  tokenId: "token-1",
                  name: "Default consumer",
                  createdAt: new Date().toISOString(),
                },
              ],
              domains: [{ hostname: "shop.example.com", status: "ready" }],
              storage: [
                {
                  volumeId: "vol-data",
                  name: "data",
                  mountPath: "/data",
                  sizeGb: 10,
                },
              ],
              updatedAt: new Date().toISOString(),
            },
            ...(created
              ? [
                  {
                    appId: "new-app-id",
                    kind: "repository",
                    scope: "repository",
                    name: "New service",
                    slug: "new-service",
                    repository: "test-owner/test-repo",
                    branch: "main",
                    rootDirectory: ".",
                    observedStatus: "provisioning",
                    desiredStatus: "running",
                    exposure: "private",
                    provider: {},
                    secretNames: [],
                    accessTokens: [],
                    domains: [],
                    storage: [],
                    updatedAt: new Date().toISOString(),
                  },
                ]
              : []),
          ],
        }),
      });
    });
    await page.route("**/api/kody/apps/inspect", (route) =>
      route.fulfill({
        json: {
          repository: "test-owner/test-repo",
          ref: "main",
          commitSha: "a".repeat(40),
          name: "New service",
          slug: "new-service",
          plan: { kind: "node", rootDirectory: ".", port: 3000 },
          requiredSecretNames: [],
        },
      }),
    );
    await page.route("**/api/kody/chat/conversations**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [] }),
      }),
    );
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      }),
    );
    await page.route("**/api/kody/apps/storefront/actions", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      appStatus = "running";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, status: "running" }),
      });
    });
    await page.route("**/api/kody/apps/storefront/open", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://storefront.fly.dev/?ka=short-lived-ticket",
        }),
      }),
    );
    await page.addInitScript(() => {
      Object.defineProperty(window, "open", {
        configurable: true,
        value: () => ({
          opener: null,
          location: {
            replace: (url: string) => {
              document.documentElement.dataset.openedAppUrl = url;
            },
          },
          close: () => undefined,
        }),
      });
    });

    await page.goto("/repo/test-owner/test-repo/apps/storefront");
    await expect(
      page.getByRole("heading", { name: "Apps", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Storefront" }),
    ).toBeVisible();
    await expect(
      page.getByText("lfnovo/open-notebook@main:apps/web"),
    ).toBeVisible();
    await expect(page.getByText("Consumer token required")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View Fly volumes" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View machines" }),
    ).toHaveAttribute(
      "href",
      "/repo/test-owner/test-repo/fly/machines/kody-app-storefront",
    );
    await expect(page.getByText("Stopped — not serving traffic")).toBeVisible();
    await page.getByRole("button", { name: "App actions" }).click();
    await page
      .getByRole("menuitem", { name: "Start app", exact: true })
      .click();
    await expect(page.getByText("Starting app…").first()).toBeVisible();
    await expect(
      page.getByText("Running — ready to open").first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open app" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-opened-app-url",
      "https://storefront.fly.dev/?ka=short-lived-ticket",
    );
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Runtime secret names")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage repository secrets" }),
    ).toBeVisible();
    await expect(page.getByText("Default consumer")).toHaveCount(0);
    await expect(page.getByText("Domains", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Storage", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete App" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "View Fly volumes" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Access" }).click();
    await expect(page.getByText("Default consumer")).toBeVisible();

    const requestsBeforeRefresh = appListRequests;
    await page.getByRole("button", { name: "Refresh apps" }).click();
    await expect
      .poll(() => appListRequests)
      .toBeGreaterThan(requestsBeforeRefresh);

    await page.getByRole("button", { name: "Deploy app" }).click();
    await expect(
      page.getByRole("dialog", { name: "Deploy repository app" }),
    ).toBeVisible();
    await expect(page.getByText("Browser is already available")).toHaveCount(0);
    await expect(page.getByText("Brain is already available")).toHaveCount(0);
    const createDialog = page.getByRole("dialog", {
      name: "Deploy repository app",
    });
    await expect(
      createDialog.getByLabel("Folder containing the app (optional)"),
    ).toHaveValue("");
    await expect(
      createDialog.getByText(
        "Leave empty if the app uses the whole repository. Example: apps/web",
      ),
    ).toBeVisible();
    await createDialog.getByLabel("App name").fill("New service");
    await createDialog.getByRole("button", { name: "Deploy app" }).click();
    await expect(page).toHaveURL(/\/apps\/new-service$/);
    await expect(
      page.getByRole("heading", { name: "New service" }),
    ).toBeVisible();
  });

  test("repairs a missing Fly app when the user clicks Start", async ({
    page,
  }) => {
    let appStatus = "failed";
    let deploymentRequests = 0;
    await mockKodyAccountSession(page, {
      id: "apps-repair-e2e",
      name: "Apps Repair E2E",
    });
    await seedRepository(page);
    await page.route("**/api/kody/apps", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          apps: [
            {
              appId: "22222222-2222-4222-8222-222222222222",
              name: "Open Notebook",
              slug: "open-notebook",
              repository: "lfnovo/open-notebook",
              branch: "main",
              rootDirectory: ".",
              observedStatus: appStatus,
              desiredStatus: "running",
              exposure: "private",
              provider: { publicUrl: "https://open-notebook.fly.dev" },
              currentDeploymentId: "33333333-3333-4333-8333-333333333333",
              secretNames: [],
              accessTokens: [],
              domains: [],
              storage: [],
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      }),
    );
    await page.route(
      "**/api/kody/apps/open-notebook/actions",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        appStatus = "running";
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            status: "deploying",
            repairing: true,
          }),
        });
      },
    );
    await page.route(
      "**/api/kody/apps/open-notebook/deployments",
      async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              deployments: [
                {
                  deploymentId: "33333333-3333-4333-8333-333333333333",
                  commitSha: "a".repeat(40),
                  status: "failed",
                  createdAt: new Date().toISOString(),
                },
              ],
            }),
          });
          return;
        }
        deploymentRequests += 1;
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ status: "building" }),
        });
      },
    );

    await page.goto("/repo/test-owner/test-repo/apps/open-notebook");
    await expect(
      page.getByText("Failed — open logs for details"),
    ).toBeVisible();
    await page.getByRole("button", { name: "App actions" }).click();
    await page
      .getByRole("menuitem", { name: "Start app", exact: true })
      .click();
    await expect(page.getByText("Starting app…").first()).toBeVisible();
    await expect(
      page.getByText("Running — ready to open").first(),
    ).toBeVisible();
    expect(deploymentRequests).toBe(0);
  });
});
