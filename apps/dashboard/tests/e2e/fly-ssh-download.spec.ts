import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";
const OWNER = "test-owner";
const REPO = "test-repo";
async function seedRepoAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ owner, repo }) => {
      const user = {
        login: "brain-route-e2e",
        avatar_url: "https://github.com/github.png",
        id: 1,
      };
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "ghp_placeholder",
          user,
          loggedInAt: Date.now(),
          repos: [
            {
              repoUrl: `https://github.com/${owner}/${repo}`,
              owner,
              repo,
              token: "ghp_placeholder",
              addedAt: Date.now(),
              isLogin: true,
              user,
            },
          ],
          currentRepoIndex: 0,
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          login: "brain-route-e2e",
          avatar_url: "https://github.com/github.png",
          githubId: 1,
        },
      }),
    }),
  );
}

test("downloads the selected machine profile and disables unprepared machines", async ({
  page,
}) => {
  await seedRepoAuth(page);
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: true, source: "repo-vault" } }),
  );
  const row = {
    app: "test-app",
    machineId: "abc123",
    feature: "app",
    state: "started",
    region: "ams",
    label: "Ready machine",
    sizeLabel: "256 MB",
    sshConfigured: true,
  };
  let machineInventoryRequests = 0;
  await page.route("**/api/kody/fly/machines", (route) => {
    machineInventoryRequests += 1;
    return route.fulfill({
      json: {
        machines: [
          row,
          {
            ...row,
            machineId: "old123",
            label: "Old machine",
            sshConfigured: false,
          },
        ],
        running: 2,
        total: 2,
      },
    });
  });
  let body: unknown;
  await page.route("**/api/kody/fly/machines/ssh", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: Buffer.from("ssh-test-archive"),
    });
  });
  await page.goto(`/repo/${OWNER}/${REPO}/fly/machines`);
  const buttons = page.getByRole("button", {
    name: "Download SSH config",
    exact: true,
  });
  const search = page.getByRole("searchbox", { name: "Search machines" });
  await expect(search).toBeVisible();
  await search.fill("test-app");
  await page.getByRole("button", { name: "Select Ready machine" }).click();
  await expect(page).toHaveURL(/\/fly\/machines\/test-app\/abc123$/);
  await expect(buttons).toHaveCount(1);
  await expect(buttons).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Ready machine", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Machine overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Suspend machine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select Old machine" }).click();
  await expect(buttons).toBeDisabled();
  await page.getByRole("button", { name: "Select Ready machine" }).click();
  await expect.poll(() => machineInventoryRequests).toBe(1);
  await expect(search).toHaveValue("test-app");
  const downloaded = page.waitForEvent("download");
  await buttons.nth(0).click();
  expect((await downloaded).suggestedFilename()).toBe(
    "kody-test-app-abc123.zip",
  );
  expect(body).toEqual({ app: "test-app", machineId: "abc123" });
  await expect(
    page.getByText("SSH settings downloaded", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/kody/fly/machines/ssh", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "This machine belongs to another user" },
    }),
  );
  await buttons.nth(0).click();
  await expect(
    page.getByText("This machine belongs to another user", { exact: true }),
  ).toBeVisible();
  await expect(buttons.nth(0)).toBeEnabled();
});

test("opens Fly machines already scoped to one app", async ({ page }) => {
  await seedRepoAuth(page);
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: true, source: "repo-vault" } }),
  );
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({
      json: {
        machines: [
          {
            app: "kody-app-storefront",
            machineId: "storefront-1",
            feature: "app",
            state: "started",
            region: "ams",
            label: "Storefront machine",
            sizeLabel: "256 MB",
            sshConfigured: true,
          },
          {
            app: "another-app",
            machineId: "other-1",
            feature: "app",
            state: "started",
            region: "ams",
            label: "Other machine",
            sizeLabel: "256 MB",
            sshConfigured: true,
          },
        ],
        running: 2,
        total: 2,
      },
    }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/fly/machines/kody-app-storefront`);
  await expect(
    page.getByRole("searchbox", { name: "Search machines" }),
  ).toHaveValue("kody-app-storefront");
  await expect(
    page.getByRole("heading", { name: "Storefront machine" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Other machine" }),
  ).toHaveCount(0);
});

test("keeps personal Brain lifecycle out of Fly infrastructure", async ({
  page,
}) => {
  await seedRepoAuth(page);
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: false, source: null } }),
  );
  let brainRequests = 0;
  await page.route(
    "**/api/kody/brain/status",
    (route) => (
      (brainRequests += 1),
      route.fulfill({ json: { state: "running" } })
    ),
  );
  await page.goto(`/repo/${OWNER}/${REPO}/fly/machines`);
  await expect(page.getByText("show repository infrastructure")).toBeVisible();
  expect(brainRequests).toBe(0);
});

test("manages persistent volumes from Fly infrastructure", async ({ page }) => {
  await seedRepoAuth(page);
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: true, source: "repo-vault" } }),
  );
  let actionBody: unknown;
  await page.route("**/api/kody/fly/volumes", (route) => {
    if (route.request().method() === "POST") {
      actionBody = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        volumes: [
          {
            app: "kody-app-open-notebook-123",
            id: "vol_data",
            name: "data",
            region: "ams",
            state: "created",
            sizeGb: 10,
            encrypted: true,
            attachedMachineId: "machine_1",
            createdAt: "2026-09-11T10:00:00.000Z",
          },
        ],
        unavailableApps: [],
      },
    });
  });

  await page.goto(`/repo/${OWNER}/${REPO}/fly/volumes`);
  await expect(
    page.getByRole("heading", { name: "Fly Volumes", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("kody-app-open-notebook-123")).toBeVisible();
  await expect(page.getByText("10 GB")).toBeVisible();
  await expect(page.getByText("Attached")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete volume" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Snapshot volume" }).click();
  await expect(page.getByText("Snapshot created.")).toBeVisible();
  expect(actionBody).toEqual({
    app: "kody-app-open-notebook-123",
    volumeId: "vol_data",
    action: "snapshot",
  });
});

for (const mobile of [false, true]) {
  test(`machine search and route selection (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED")
        errors.push(request.url());
    });
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await seedRepoAuth(page);
    await page.route("**/api/kody/models?catalog=opencode-free", (route) =>
      route.fulfill({ json: { models: [] } }),
    );
    await page.route("**/api/kody/fly/config-status", (route) =>
      route.fulfill({ json: { configured: true, source: "repo-vault" } }),
    );
    await page.route("**/api/kody/fly/machines", (route) =>
      route.fulfill({
        json: {
          machines: [
            {
              app: "test-app",
              machineId: "abc123",
              feature: "app",
              state: "started",
              region: "ams",
              label: "A machine with a very long readable name",
              sizeLabel: "256 MB",
              sshConfigured: false,
            },
          ],
          total: 1,
          running: 1,
        },
      }),
    );
    await page.goto(`/repo/${OWNER}/${REPO}/fly/machines`);
    // Desktop selects the first machine on initial load. Let that route
    // transition finish before this journey exercises searching the list.
    if (!mobile) {
      await expect(page).toHaveURL(/\/fly\/machines\/test-app\/abc123$/);
      await expect(
        page.getByRole("heading", {
          name: "A machine with a very long readable name",
        }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", {
          name: "Select A machine with a very long readable name",
        }),
      ).toBeVisible();
    }
    const search = page.getByRole("searchbox", { name: "Search machines" });
    await search.fill("missing");
    await expect(
      page.getByText("No matching machines", { exact: true }),
    ).toBeVisible();
    await search.fill("ams");
    await page
      .getByRole("button", {
        name: "Select A machine with a very long readable name",
      })
      .click();
    await expect(page).toHaveURL(/\/fly\/machines\/test-app\/abc123$/);
    await expect(
      page.getByRole("heading", {
        name: "A machine with a very long readable name",
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "A machine with a very long readable name",
      }),
    ).toBeVisible();
    if (mobile) {
      await expect(search).toBeHidden();
      await page.getByRole("button", { name: "Back to machines" }).click();
      await expect(search).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
