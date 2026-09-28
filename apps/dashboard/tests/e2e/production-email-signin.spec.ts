import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

test("shows production email sign-in without registration", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "qa-user" } }),
    }),
  );

  await page.goto(`${BASE_URL}/memory`);

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create an account" }),
  ).toHaveCount(0);

  await page.getByLabel("Email").fill("qa@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  const request = page.waitForRequest("**/api/auth/sign-in/email");
  await page.getByRole("button", { name: "Sign in" }).click();
  await request;
});
