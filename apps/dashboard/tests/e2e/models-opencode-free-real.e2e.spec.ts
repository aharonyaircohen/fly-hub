import { expect, test } from "./live-test";

test("live OpenCode catalog and saved model work in the mounted Models editor", async ({
  page,
}) => {
  const marker = `OpenCode verification ${Date.now()}`;
  const accountReady = page.waitForResponse((response) =>
    response.url().endsWith("/api/kody/account/repositories"),
  );
  await page.goto("/models");
  const account = await (await accountReady).json();
  if (account.auth?.owner && account.auth?.repo) {
    await expect(
      page.getByRole("link", { name: /^Kody home/ }),
    ).toHaveAttribute(
      "href",
      `/repo/${account.auth.owner}/${account.auth.repo}`,
    );
  }
  await page.getByRole("button", { name: "New model" }).click();
  const dialog = page.getByRole("dialog", { name: "Add model" });
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/kody/models?catalog=opencode-free"),
  );
  await dialog
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("opencode-free");
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const { models } = await response.json();
  expect(models.length).toBeGreaterThan(0);
  await dialog
    .getByRole("combobox", { name: "Model name" })
    .selectOption(models[0].id);
  await expect(
    dialog.getByRole("button", { name: "Add", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("textbox", { name: "API key name" }),
  ).toHaveCount(0);
  await dialog
    .getByText("Display label", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(marker);
  try {
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
  } finally {
    const response = await page.request.get("/api/kody/models?scope=personal");
    expect(response.ok()).toBe(true);
    const settings = await response.json();
    const ownModel = settings.models.find(
      (model: { label: string }) => model.label === marker,
    );
    if (ownModel) {
      const cleanup = await page.request.put("/api/kody/models", {
        data: {
          ...settings,
          models: settings.models.filter(
            (model: { id: string }) => model.id !== ownModel.id,
          ),
        },
      });
      expect(cleanup.ok()).toBe(true);
    }
  }
});
