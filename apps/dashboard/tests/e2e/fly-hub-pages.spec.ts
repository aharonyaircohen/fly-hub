import { expect, test, type Page } from "@playwright/test";

async function connected(page: Page) {
  await page.route("**/api/fly-hub/session", (route) =>
    route.fulfill({ json: { connected: true, orgSlug: "personal" } }),
  );
}

test("Machines has a create action with no machines", async ({ page }) => {
  await connected(page);
  await page.route("**/api/kody/fly/machines", (route) =>
    route.fulfill({ json: { machines: [], total: 0, running: 0 } }),
  );
  await page.goto("/fly/machines");
  await expect(page.getByRole("heading", { name: "No machines yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create machine" })).toHaveCount(2);
  await expect(page.getByText("repository", { exact: false })).toHaveCount(0);
});

test("creates a named machine with selected size, region, and sleep setting", async ({ page }) => {
  await connected(page);
  let submitted: Record<string, unknown> | null = null;
  const machines: Array<Record<string, unknown>> = [];
  await page.route("**/api/kody/fly/machines", (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      machines.push({
        app: "flyhub-test-app", machineId: "new-machine", feature: "other",
        state: "started", region: "ams", label: submitted.name,
        sizeLabel: "performance 2x · 4 GB", sshConfigured: true,
      });
      return route.fulfill({ status: 201, json: {
        app: "flyhub-test-app", machineId: "new-machine", region: "ams", state: "started",
      } });
    }
    return route.fulfill({ json: { machines, total: machines.length, running: machines.length } });
  });
  await page.goto("/fly/machines");
  await page.getByRole("button", { name: "Create machine" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create machine" });
  await dialog.getByRole("textbox", { name: "Machine name" }).fill("My machine");
  await dialog.getByText("Fast", { exact: true }).click();
  await dialog.getByRole("textbox", { name: /Region/ }).fill("ams");
  await dialog.getByRole("checkbox", { name: /Sleep when idle/ }).uncheck();
  await dialog.getByRole("button", { name: "Create machine" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/fly\/machines\/flyhub-test-app\/new-machine$/);
  await expect(page.getByRole("heading", { name: "My machine" })).toBeVisible();
  expect(submitted).toMatchObject({ name: "My machine", size: "high", region: "ams", sleepWhenIdle: false });
});

test("suspends, resumes, and destroys a machine", async ({ page }) => {
  await connected(page);
  let state: "started" | "suspended" | "deleted" = "started";
  const actions: string[] = [];
  await page.route("**/api/kody/fly/machines", (route) => route.fulfill({ json: {
    machines: state === "deleted" ? [] : [{
      app: "flyhub-test-app", machineId: "lifecycle-machine", feature: "other",
      state, region: "fra", label: "Lifecycle test", sizeLabel: "2 GB", sshConfigured: true,
    }],
    total: state === "deleted" ? 0 : 1,
    running: state === "started" ? 1 : 0,
  } }));
  await page.route("**/api/kody/fly/machines/action", (route) => {
    const body = route.request().postDataJSON() as { action: string };
    actions.push(body.action);
    if (body.action === "suspend") state = "suspended";
    if (body.action === "start") state = "started";
    if (body.action === "destroy") state = "deleted";
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/fly/machines");
  await page.getByRole("button", { name: "Suspend machine" }).click();
  await expect(page.getByRole("button", { name: "Resume machine" })).toBeVisible();
  await page.getByRole("button", { name: "Resume machine" }).click();
  await expect(page.getByRole("button", { name: "Suspend machine" })).toBeVisible();
  await page.getByRole("button", { name: "Destroy machine" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Destroy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No machines yet" })).toBeVisible();
  expect(actions).toEqual(["suspend", "start", "destroy"]);
});

test("History shows Fly machine events", async ({ page }) => {
  await connected(page);
  await page.route("**/api/kody/fly/activity", (route) =>
    route.fulfill({ json: { history: [{
      app: "flyhub-test-app", machineId: "abc123", label: "Ready machine",
      state: "suspended", type: "suspension", source: "flyd", timestamp: Date.now(),
    }] } }),
  );
  await page.goto("/fly/history");
  await expect(page.getByRole("heading", { name: "Machine history", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("article").getByRole("heading", { name: "Ready machine" })).toBeVisible();
  await expect(page.getByRole("article").getByText("Suspended")).toBeVisible();
});

test("old Settings URL opens Machines", async ({ page }) => {
  await connected(page);
  await page.goto("/fly/config");
  await expect(page).toHaveURL(/\/fly\/machines$/);
  await expect(page.getByRole("navigation", { name: "Fly pages" }).getByRole("link", { name: "Settings" })).toHaveCount(0);
});
