/**
 * @fileoverview Browser proof that repository Capability actions are handed
 * to the visible Views surface before the Dashboard attempts the action.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { expect, test, type Page } from "@playwright/test";
import { openChatSetupSection } from "./support/chat-setup";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const REPO_ROOT = `${BASE_URL}/repo/test-owner/test-repo`;

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
        user: { login: "views-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:test/model",
    );
  });
}

test("a Capability browser action opens Views before it can act", async ({
  page,
}) => {
  await mockKodyAccountSession(page);
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return route.fulfill({
      status: request.method() === "POST" && isCollection ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        request.method() === "GET" && isCollection
          ? { conversations: [] }
          : { ok: true },
      ),
    });
  });
  await page.route("**/api/kody/chat/kody", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body:
        `data: ${JSON.stringify({
          type: "data-chat-output-contract",
          data: { mode: "exclusive-tool" },
        })}\n\n` +
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "browser-action",
          toolName: "browser_capability_act",
          input: {},
        })}\n\n` +
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "browser-action",
          output: {
            action: "preview_act",
            op: "navigate",
            url: "https://www.facebook.com/",
            capabilitySlug: "prepare-facebook-personal-post",
            allowedOrigins: ["https://www.facebook.com"],
            reason: "Prepare the approved post in Facebook",
          },
        })}\n\n` +
        `data: ${JSON.stringify({
          type: "tool-input-available",
          toolCallId: "final-answer",
          toolName: "final_answer",
          input: { content: "Opening Views." },
        })}\n\n` +
        `data: ${JSON.stringify({
          type: "tool-output-available",
          toolCallId: "final-answer",
          output: { content: "Opening Views." },
        })}\n\n` +
        'data: {"type":"finish"}\n\ndata: [DONE]\n\n',
    }),
  );

  await seedAuth(page);
  await page.goto(`${REPO_ROOT}/file-spaces/content-studio`);

  const chat = page.locator('[aria-label="Kody chat"]').first();
  const modelMenu = await openChatSetupSection(chat, "Model");
  await modelMenu
    .locator('button[role="option"]')
    .filter({ hasText: "Kody Test" })
    .click();
  const composer = chat.locator("textarea").first();
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Prepare this post on Facebook");
  await chat.getByRole("button", { name: "Send message" }).click();

  await expect(page).toHaveURL(`${REPO_ROOT}/preview`, { timeout: 15_000 });
});
