import { expect, test } from "@playwright/test";

test("external host completes the supported chat integration journey", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  await page.goto("http://127.0.0.1:4178");
  await expect(
    page.getByRole("banner").or(page.getByText("External Kody Chat")),
  ).toBeVisible();
  await expect(page.getByTestId("kody-chat-frame")).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByLabel("Conversation title")).toHaveValue(
    "New conversation",
  );
  await page.getByLabel("Conversation title").fill("Customer support");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("combobox", { name: "Conversation" }),
  ).toContainText("Customer support");

  const composer = page.getByLabel("Message");
  await composer.fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Hello from external host").first(),
  ).toBeVisible();

  await composer.fill("slow");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.locator('[data-status="streaming"]')).toHaveCount(0);

  await composer.fill("fail");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("External transport failed")).toBeVisible();

  await composer.fill("navigate");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("navigation-result")).toHaveText(
    "/external/help",
  );
  await expect(page.getByTestId("plugin-event")).toHaveText("done");

  await composer.fill("context");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Context: external-demo")).toBeVisible();

  await composer.fill("unauthorized");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Unauthorized server action")).toBeVisible();

  await page.getByLabel("Attach file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("external attachment"),
  });
  await expect(page.getByText("notes.txt")).toBeVisible();
  await composer.fill("attachment");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(/Attachment received in external-/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Fail saves" }).click();
  await composer.fill("storage check");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "External storage failed",
  );
  await page.getByRole("button", { name: "Allow saves" }).click();
  const retrySave = page.getByRole("button", { name: "Retry save" });
  if (await retrySave.isVisible()) {
    try {
      await retrySave.click({ timeout: 2_000 });
    } catch (error) {
      if (await page.getByRole("alert").count()) throw error;
    }
  }
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".kody-chat")).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete conversation" }),
  ).toBeVisible();
  const mobileBox = await page.locator(".kody-chat").boundingBox();
  expect(mobileBox?.width).toBeLessThanOrEqual(390);
  const mobileLayout = await page.locator(".kody-chat").evaluate((root) => {
    const sessions = root.querySelector<HTMLElement>(".kody-chat__sessions");
    const composer = root.querySelector<HTMLElement>(".kody-chat__composer");
    const rootRect = root.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      sessionsScrollWidth: sessions?.scrollWidth ?? 0,
      sessionsClientWidth: sessions?.clientWidth ?? 0,
      composerInsideRoot:
        Boolean(composerRect) &&
        composerRect!.left >= rootRect.left &&
        composerRect!.right <= rootRect.right &&
        composerRect!.bottom <= rootRect.bottom,
    };
  });
  expect(mobileLayout.rootScrollWidth).toBeLessThanOrEqual(
    mobileLayout.rootClientWidth,
  );
  expect(mobileLayout.sessionsScrollWidth).toBeLessThanOrEqual(
    mobileLayout.sessionsClientWidth,
  );
  expect(mobileLayout.composerInsideRoot).toBe(true);

  await page.reload();
  await page
    .getByRole("combobox", { name: "Conversation" })
    .selectOption({ label: "Customer support" });
  await expect(
    page.getByText("Hello from external host").first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Attachment received in external-/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await expect(
    page.getByRole("combobox", { name: "Conversation" }),
  ).not.toContainText("Customer support");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([
    "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
  ]);
  expect(failedRequests).toEqual([]);
});
