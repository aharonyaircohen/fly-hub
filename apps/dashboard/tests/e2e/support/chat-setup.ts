import type { Locator } from "@playwright/test";

export async function openChatSetupSection(
  chat: Locator,
  section: "Agency agent" | "Model" | "Effort" | "Machine",
): Promise<Locator> {
  const menu = chat.getByTestId("chat-setup-menu");
  if (!(await menu.isVisible())) {
    await chat.getByLabel("Chat setup").first().click();
  }
  const row = chat.getByLabel(section).first();
  if ((await row.getAttribute("aria-expanded")) !== "true") {
    await row.click();
  }
  return chat.locator('[role="listbox"]:visible').last();
}
