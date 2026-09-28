import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

const entry = {
  slug: "company-profile",
  body: "Kody builds useful software.",
  agent: ["kody-chat"],
  updatedAt: "2026-07-13T00:00:00.000Z",
  htmlUrl:
    "https://github.com/test-owner/test-repo/blob/main/context/company-profile.md",
};

async function openEditDialog(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.route("**/api/kody/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [entry] }),
    }),
  );
  await page.route("**/api/kody/agents", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agent: [] }),
    }),
  );

  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "context-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
  });
  await page.goto(`${BASE_URL}/context/company-profile`);

  await page.getByRole("button", { name: "Edit entry" }).click();
  return page.getByRole("dialog");
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test(`edit dialog shows one Content field on ${viewport.name}`, async ({
    page,
  }) => {
    const dialog = await openEditDialog(page, viewport);

    await expect(dialog.getByText("Content", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Current saved content")).toHaveCount(0);
    await expect(dialog.getByText("Active file")).toHaveCount(0);
  });
}
