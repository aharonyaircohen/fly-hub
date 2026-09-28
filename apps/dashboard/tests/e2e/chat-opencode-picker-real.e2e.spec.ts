import { test, expect } from "./live-test";
import { openChatSetupSection } from "./support/chat-setup";

test("live free models are selectable directly in Chat", async ({ page }) => {
  const accountReady = page.waitForResponse((response) =>
    response.url().endsWith("/api/kody/account/repositories"),
  );
  await page.goto("/chat");
  const account = await (await accountReady).json();
  if (account.auth?.owner && account.auth?.repo)
    await expect(
      page.getByRole("link", { name: /^Kody home/ }),
    ).toHaveAttribute(
      "href",
      `/repo/${account.auth.owner}/${account.auth.repo}`,
    );
  const response = await page.request.get(
    "/api/kody/models?catalog=opencode-free",
  );
  expect(response.ok()).toBe(true);
  const { models } = await response.json();
  expect(models.length).toBeGreaterThan(0);
  const chat = page.locator('[aria-label="Kody chat"]').first();
  const menu = await openChatSetupSection(chat, "Model");
  const option = menu.getByRole("option").filter({ hasText: "OpenCode Free" });
  await expect(
    menu
      .getByRole("group", { name: "Built-in models", exact: true })
      .getByRole("option")
      .filter({ hasText: "OpenCode Free" }),
  ).toBeVisible();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "/tmp/kody-live-free-model-picker.png" });
  await option.click();
  await expect(chat.getByLabel("Chat setup").first()).toHaveAttribute(
    "title",
    /OpenCode Free/,
  );
});
