import { expect, test } from "@playwright/test";

test("asks for a Fly token without Kody sign-in", async ({ page }) => {
  await page.route("**/api/fly-hub/session", (route) =>
    route.fulfill({ json: { connected: false, orgSlug: null } }),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/fly\/machines$/);
  await expect(page.getByRole("heading", { name: "Connect to Fly Hub" })).toBeVisible();
  await expect(page.getByLabel("Fly API token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
});

test("connects with a Fly token and remembers the session after reload", async ({ page }) => {
  let connected = false;
  let submittedToken = "";
  await page.route("**/api/fly-hub/session", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      submittedToken = (route.request().postDataJSON() as { token: string }).token;
      connected = true;
    }
    if (method === "DELETE") connected = false;
    await route.fulfill({ json: { connected, orgSlug: connected ? "personal" : null } });
  });
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({ json: { machines: [], total: 0, running: 0 } }),
  );
  await page.goto("/fly/machines");
  await page.getByLabel("Fly API token").fill("fly-test-token");
  await page.getByRole("button", { name: "Connect Fly" }).click();
  await expect(page.getByRole("navigation", { name: "Fly pages" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Fly pages" }).getByRole("link")).toHaveCount(4);
  expect(submittedToken).toBe("fly-test-token");
  await expect(page.getByTitle("Switch repository")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disconnect" }).locator("svg")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Fly pages" })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect to Fly Hub" })).toBeVisible();
});

test("theme selection changes the dashboard and follows the system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/api/fly-hub/session", (route) =>
    route.fulfill({ json: { connected: true, orgSlug: "personal" } }),
  );
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({ json: { machines: [], total: 0, running: 0 } }),
  );
  await page.goto("/fly/machines");
  const theme = page.getByRole("combobox", { name: "Select a theme" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme.click();
  await page.getByRole("option", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.locator(".fly-hub").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(246, 248, 250)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.click();
  await page.getByRole("option", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("kody-theme"))).toBeNull();
});

test("shows invalid Fly token error", async ({ page }) => {
  await page.route("**/api/fly-hub/session", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 401, json: { error: "Fly could not verify this token." } })
      : route.fulfill({ json: { connected: false, orgSlug: null } }),
  );
  await page.goto("/fly/machines");
  await page.getByLabel("Fly API token").fill("wrong");
  await page.getByRole("button", { name: "Connect Fly" }).click();
  await expect(page.getByText("Fly could not verify this token.")).toBeVisible();
});
