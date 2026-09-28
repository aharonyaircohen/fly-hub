import { expect, test } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

test("adds a refreshed free model without credentials or default changes", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("kody_auth", JSON.stringify({ owner: "test-owner", repo: "test-repo", repoUrl: "https://github.com/test-owner/test-repo", token: "ghp_placeholder", user: { login: "test-owner", id: 1, avatar_url: "" }, loggedInAt: Date.now() })));
  await mockDashboardShellRequests(page);
  let catalogFailed = false;
  let engineWrites = 0;
  let catalog = [
    { id: "first-free", label: "First free", adapter: "openai-compatible" },
  ];
  let models: Array<Record<string, unknown>> = [
    {
      id: "primary",
      label: "Primary",
      provider: "openai",
      protocol: "openai",
      modelName: "primary",
      baseURL: "https://api.openai.com/v1",
      apiKeySecret: "OPENAI_API_KEY",
      enabled: true,
      default: true,
    },
  ];
  await page.route("**/api/kody/models*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("catalog")) {
      await route.fulfill({ status: catalogFailed ? 503 : 200, json: { models: catalog } });
    } else {
      if (route.request().method() === "PUT")
        models = route.request().postDataJSON().models;
      await route.fulfill({
        json: { models, automatic: { default: false, engineDefault: false } },
      });
    }
  });
  await page.route("**/api/kody/engine-models", (route) => {
    if (route.request().method() === "PUT") engineWrites++;
    return route.fulfill({
      json: { models: [], automatic: { default: false, engineDefault: false } },
    });
  });
  await page.goto("/models");
  await page.getByRole("button", { name: "New model" }).click();
  const dialog = page.getByRole("dialog", { name: "Add model" });
  await dialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("opencode-free");
  await expect(
    dialog.getByRole("textbox", { name: "API key name" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText("Default for engine", { exact: false }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "Model name" })
    .selectOption("first-free");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    models.find((model) => model.modelName === "first-free"),
  ).toMatchObject({
    provider: "opencode-free",
    apiKeySecret: "",
    engineDefault: false,
    default: false,
  });
  expect(models.find((model) => model.id === "primary")?.default).toBe(true);
  expect(engineWrites).toBe(0);
  catalog = [
    {
      id: "replacement-free",
      label: "Replacement free",
      adapter: "openai-responses",
    },
  ];
  await page.getByRole("button", { name: "New model" }).click();
  await dialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("opencode-free");
  await expect(
    dialog.getByRole("option", { name: "Replacement free" }),
  ).toHaveCount(1);
  await expect(dialog.getByRole("option", { name: "First free" })).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  catalogFailed = true;
  await page.getByRole("button", { name: "New model" }).click();
  await dialog.getByRole("combobox", { name: "Provider", exact: true }).selectOption("opencode-free");
  await expect(dialog.getByRole("alert")).toContainText("unavailable");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  catalogFailed = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await dialog.getByRole("combobox", { name: "Model name" }).selectOption("replacement-free");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
});
