/** @testFramework playwright @domain e2e-live */
import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const OWNER = "aharonyaircohen";
const REPO = "kody-chat";

async function seedLiveRepository(page: Page) {
  const headers = {
    "x-kody-token": TOKEN,
    "x-kody-owner": OWNER,
    "x-kody-repo": REPO,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  await page
    .context()
    .addInitScript(
      (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
      {
        repoUrl: `https://github.com/${OWNER}/${REPO}`,
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        user,
        loggedInAt: Date.now(),
        repos: [],
        currentRepoIndex: 0,
      },
    );
}

test("renders the real Apps workspace without mutating it", async ({
  page,
}) => {
  test.skip(!BASE_URL || !TOKEN, "Requires the local target and QA account");
  await seedLiveRepository(page);

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/apps/open-notebook`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "open-notebook", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Refresh apps" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "View machines" })).toBeVisible();

  const refreshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().endsWith("/api/kody/apps"),
  );
  await page.getByRole("button", { name: "Refresh apps" }).click();
  expect((await refreshResponse).ok()).toBe(true);

  await page.getByRole("button", { name: "Deploy app", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Deploy repository app" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Folder containing the app (optional)"),
  ).toHaveValue("");
  await expect(
    page.getByText(
      "Leave empty if the app uses the whole repository. Example: apps/web",
    ),
  ).toBeVisible();
  await expect(page.getByText("Browser is already available")).toHaveCount(0);
  await expect(page.getByText("Brain is already available")).toHaveCount(0);
});

test("starts and opens the real managed App", async ({ page }) => {
  test.setTimeout(900_000);
  test.skip(!BASE_URL || !TOKEN, "Requires the local target and QA account");
  await seedLiveRepository(page);

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/apps/open-notebook`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "open-notebook", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });

  const stopButton = page.getByRole("button", {
    name: "Stop app",
    exact: true,
  });
  if (await stopButton.isEnabled()) {
    const stopResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/apps/open-notebook/actions"),
    );
    await stopButton.click();
    expect((await stopResponse).ok()).toBe(true);
    await expect(page.getByText("Stopped — not serving traffic")).toBeVisible({
      timeout: 30_000,
    });
  }

  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/kody/apps/open-notebook/actions"),
  );
  await page.getByRole("button", { name: "Start app", exact: true }).click();
  const start = await actionResponse;
  const startBody = await start.json().catch(() => ({}));
  expect([200, 202], `Start failed: ${JSON.stringify(startBody)}`).toContain(
    start.status(),
  );
  if (start.status() === 202) {
    expect(startBody).toMatchObject({ repairing: true, status: "deploying" });
    await expect(
      page.getByText("Deploying — building and checking health"),
    ).toBeVisible({ timeout: 30_000 });
  } else expect(startBody).toMatchObject({ status: "running" });
  await expect(page.getByText("Running — ready to open")).toBeVisible({
    timeout: 720_000,
  });

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open app", exact: true }).click();
  const appPage = await popupPromise;
  await appPage.waitForURL(/\.fly\.dev/, { timeout: 60_000 });
  await appPage.waitForLoadState("domcontentloaded");
  await expect(appPage.locator("body")).not.toContainText(
    "request_auth_required",
  );
  expect(new URL(appPage.url()).searchParams.has("ka")).toBe(false);
});
