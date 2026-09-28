import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

test("shows a clear error when a social provider is unavailable", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Provider not found",
        code: "PROVIDER_NOT_FOUND",
      }),
    }),
  );

  await page.goto(`${BASE_URL}/memory`);
  await page.getByRole("button", { name: "Continue with GitHub" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "GitHub sign-in is not available.",
    }),
  ).toBeVisible();
});

test("opens the provider URL returned by social sign-in", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page.route("**/api/auth/sign-in/social", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      provider: "google",
      callbackURL: `${BASE_URL}/chat`,
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: `${BASE_URL}/auth-test-target`,
        redirect: true,
      }),
    });
  });
  await page.route("**/auth-test-target", (route) =>
    route.fulfill({ status: 200, body: "OAuth target" }),
  );

  await page.goto(`${BASE_URL}/memory`);
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page).toHaveURL(`${BASE_URL}/auth-test-target`);
});
