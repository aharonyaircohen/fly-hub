import { expect, test } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

test("opens Fly Config instead of the Kody Chat home page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/fly\/config$/);
  await expect(page.getByRole("heading", { name: "Sign in to Fly Hub" })).toBeVisible();
  await expect(page.getByText("Start chatting now")).toHaveCount(0);
  const chatPage = await page.goto("/chat");
  expect(chatPage?.status()).toBe(404);
});

test("shows only the original Fly sections after sign-in", async ({ page }) => {
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: true, source: "repo-vault" } }),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/fly\/config$/);
  const navigation = page.getByRole("navigation", { name: "Fly pages" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect a repository" })).toBeVisible();
  await expect(page.getByTitle("Switch repository")).toBeVisible();
  await expect(navigation.locator("a")).toHaveText([
    "Config",
    "Brain",
    "Previews",
    "Brain Images",
    "Live machines",
    "Volumes",
    "History",
  ]);
  await expect(page.getByRole("link", { name: "Chat", exact: true })).toHaveCount(0);
});
