import { expect, test } from "@playwright/test";

test("downloads SSH settings for a Fly machine", async ({ page }) => {
  await page.route("**/api/fly-hub/session", (route) =>
    route.fulfill({ json: { connected: true, orgSlug: "personal" } }),
  );
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({ json: { machines: [{
      app: "flyhub-test-app", machineId: "abc123", feature: "other",
      state: "started", region: "ams", label: "Ready machine",
      sizeLabel: "2 GB", sshConfigured: true,
    }], total: 1, running: 1 } }),
  );
  let body: unknown;
  await page.route("**/api/kody/fly/machines/ssh", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/zip", body: Buffer.from("ssh-test-archive") });
  });
  await page.goto("/fly/machines");
  const button = page.getByRole("button", { name: "Download SSH config" });
  await expect(button).toBeEnabled();
  const download = page.waitForEvent("download");
  await button.click();
  expect((await download).suggestedFilename()).toBe("flyhub-flyhub-test-app-abc123.zip");
  expect(body).toEqual({ app: "flyhub-test-app", machineId: "abc123" });
});

test("explains when a machine has no SSH settings", async ({ page }) => {
  await page.route("**/api/fly-hub/session", (route) =>
    route.fulfill({ json: { connected: true, orgSlug: "personal" } }),
  );
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({ json: { machines: [{
      app: "legacy-app", machineId: "old123", feature: "other",
      state: "started", region: "ams", label: "Old machine",
      sizeLabel: "2 GB", sshConfigured: false,
    }], total: 1, running: 1 } }),
  );
  await page.goto("/fly/machines");
  await expect(page.getByRole("button", { name: "Download SSH config" })).toBeDisabled();
  await expect(page.getByText(/SSH configuration was not prepared/)).toBeVisible();
});
