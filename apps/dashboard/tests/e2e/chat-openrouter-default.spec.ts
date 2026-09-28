import { expect, test, type Page } from "@playwright/test";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

async function seedAuth(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "chat-picker-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.removeItem("kody-sessions-v3:test-owner/test-repo");
    localStorage.removeItem("kody-sessions-v3");
    localStorage.removeItem("kody-chat:sessions-panel-pinned");
  });
}

test("shows OpenRouter Free in the chat header model picker", async ({
  page,
}) => {
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    }),
  );
  await seedAuth(page);

  await page.goto(`${BASE_URL}/chat`);
  await expect(page).toHaveURL(/\/chat$/);

  const chat = page.locator('[aria-label="Kody chat"]').first();
  const conversations = chat.getByLabel("Toggle conversations");
  if ((await conversations.getAttribute("aria-expanded")) === "true") {
    await chat
      .getByTestId("session-sidebar")
      .getByLabel("Close conversations")
      .click();
  }
  const picker = chat.getByLabel("Chat setup").first();
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker).toHaveAttribute("title", /OpenRouter Free/);

  const listbox = await openChatSetupSection(chat, "Model");
  const menu = listbox.locator("..");
  await expect(menu).toBeVisible();
  await expect(
    listbox.locator('button[role="option"]').filter({
      hasText: "OpenRouter Free",
    }),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) >= 600) {
    const chatBox = await chat.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(
      chatBox!.x + chatBox!.width + 1,
    );
  }
});
