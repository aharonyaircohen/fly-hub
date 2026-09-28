import { test, expect } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";
import { openChatSetupSection } from "./support/chat-setup";

test("offers free models directly in Chat without saving settings", async ({
  page,
  isMobile,
}) => {
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "personal::custom/my-model", label: "My model", enabled: true },
        ],
        automatic: { default: false, engineDefault: false },
      },
    }),
  );
  await page.route("**/api/kody/models?catalog=opencode-free", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "new-free", label: "New Free", adapter: "openai-compatible" },
        ],
      },
    }),
  );
  await page.goto("/chat");
  if (isMobile) await page.getByTestId("session-sidebar").getByRole("button", { name: "Close conversations", exact: true }).click();
  const chat = page.locator('[aria-label="Kody chat"]').first();
  const menu = await openChatSetupSection(chat, "Model");
  const option = menu.getByRole("option").filter({ hasText: "OpenCode Free" });
  const builtIn = menu.getByRole("group", {
    name: "Built-in models",
    exact: true,
  });
  const personal = menu.getByRole("group", {
    name: "Your models",
    exact: true,
  });
  await expect(
    builtIn.getByRole("option").filter({ hasText: "OpenRouter Free" }),
  ).toBeVisible();
  await expect(
    builtIn.getByRole("option").filter({ hasText: "OpenCode Free" }),
  ).toBeVisible();
  await expect(
    personal.getByRole("option").filter({ hasText: "My model" }),
  ).toBeVisible();
  await expect(
    builtIn.getByRole("option").filter({ hasText: "My model" }),
  ).toHaveCount(0);
  await expect(option).toBeVisible();
  await expect(
    menu.getByRole("option").filter({ hasText: "New Free" }),
  ).toHaveCount(0);
  await option.click();
  await expect(chat.getByLabel("Chat setup").first()).toHaveAttribute(
    "title",
    /OpenCode Free/,
  );
});
