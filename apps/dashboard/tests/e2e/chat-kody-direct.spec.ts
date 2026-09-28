/**
 * @fileoverview Kody direct agent UI e2e — selects the "Kody" agent,
 * mocks /api/kody/chat/kody at the network level with a streaming body,
 * and asserts the reply renders chunk-by-chunk in the assistant bubble.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * The real chat-model call needs the server-side provider API key; covering
 * that end-to-end is left to a gated @real test.
 */

import { test, expect, type Page } from "@playwright/test";
import { openChatSetupSection } from "./support/chat-setup";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "ghp_placeholder";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/test-owner/test-repo";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "test-owner", repo: parts[1] ?? "test-repo" };
  } catch {
    return { owner: "test-owner", repo: "test-repo" };
  }
}

function chatUrl(): string {
  const { owner, repo } = parseRepo(TEST_REPO);
  return `${BASE_URL.replace(/\/$/, "")}/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/chat`;
}

async function injectAuth(page: Page): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.evaluate(
    ({ auth, owner, repo }) => {
      const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      localStorage.setItem(
        `kody-default-chat-entry:${repoKey}`,
        "kody:test/model",
      );
      localStorage.removeItem(`kody-sessions-v3:${repoKey}`);
      localStorage.removeItem("kody-sessions-v3");
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "kody-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      },
      owner,
      repo,
    },
  );
}

async function selectKodyAgent(page: Page): Promise<void> {
  const chat = page.locator('[aria-label="Kody chat"]');
  const trigger = chat.getByLabel("Chat setup").first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  if (/Kody Test/i.test((await trigger.getAttribute("title")) ?? "")) return;

  const menu = await openChatSetupSection(chat, "Model");
  const option = menu
    .locator('button[role="option"]')
    .filter({ hasText: "Kody Test" });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(trigger).toHaveAttribute("title", /Kody Test/i, {
    timeout: 5_000,
  });
  // Close the menu so it doesn't cover the composer.
}

test.describe("Kody direct agent", () => {
  test.beforeEach(async ({ page }) => {
    await mockKodyAccountSession(page);
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
    // The in-process "Kody" agent only appears in the picker when at least
    // one enabled model is configured (one dropdown row per model, named by
    // its label). Mock the model list so the option exists — labelled
    // "Kody …" so the existing /^Kody\b/ option selector still matches.
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "test/model", label: "Kody Test", enabled: true }],
        }),
      }),
    );
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");
    await injectAuth(page);
  });

  test("keeps the login token when Chat opens before a repository is connected", async ({
    page,
  }) => {
    await page.evaluate((token) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: "",
          owner: "",
          repo: "",
          token,
          user: { login: "kody-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
          repos: [],
          currentRepoIndex: -1,
        }),
      );
      // The mounted host restores account-owned connections, so seed the
      // account fixture as well as the legacy browser mirror.
      localStorage.setItem(
        "kody_e2e_account_auth",
        localStorage.getItem("kody_auth")!,
      );
    }, TEST_TOKEN);

    let requestHeaders: Record<string, string> = {};
    await page.route("**/api/kody/chat/kody", async (route) => {
      requestHeaders = route.request().headers();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"text-delta","delta":"Signed in"}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      });
    });

    await page.goto(`${BASE_URL}/`);
    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    await chat.locator("textarea").first().fill("hello");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(chat.getByText("Signed in", { exact: true })).toBeVisible();
    expect(requestHeaders["x-kody-token"]).toBe(TEST_TOKEN);
    expect(requestHeaders["x-kody-owner"]).toBeUndefined();
    expect(requestHeaders["x-kody-repo"]).toBeUndefined();
  });

  test("selecting Kody and sending a message streams reply into the assistant bubble", async ({
    page,
  }) => {
    const conversationCommands: Array<Record<string, unknown>> = [];
    await page.route(
      "**/api/kody/chat/conversations/*/commands",
      async (route) => {
        conversationCommands.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );
    // Mock the direct-chat endpoint with the AI-SDK UI-message-stream SSE
    // shape the client actually parses (`data: {type:"text-delta",...}`) so
    // we verify the stream-reading path without hitting the model.
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}\n\n' +
          'data: {"type":"tool-input-available","toolCallId":"direct-final","toolName":"final_answer","input":{"content":"Hello from Kody direct!"}}\n\n' +
          'data: {"type":"tool-output-available","toolCallId":"direct-final","output":{"content":"Hello from Kody direct!"}}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    await selectKodyAgent(page);

    const input = page.locator('[aria-label="Kody chat"] textarea').first();
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill("ping");
    await page
      .locator('[aria-label="Kody chat"]')
      .getByRole("button", { name: "Send message" })
      .click();

    // The streamed text lands in an assistant bubble — assert on the text
    // itself rather than a brittle class chain.
    await expect(page.getByText("Hello from Kody direct!").first()).toBeVisible(
      { timeout: 15_000 },
    );
    await expect
      .poll(() => conversationCommands, { timeout: 10_000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "append-message",
            role: "assistant",
            content: "",
            status: "pending",
          }),
          expect.objectContaining({
            kind: "update-message",
            content: "Hello from Kody direct!",
            status: "committed",
          }),
        ]),
      );
    expect(conversationCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "update-message",
          status: "committed",
        }),
      ]),
    );
  });

  test("self-configuration uses one approval and ends with verified run evidence", async ({
    page,
  }) => {
    let turn = 0;
    await page.route("**/api/kody/chat/kody", async (route) => {
      turn += 1;
      const output =
        turn === 1
          ? {
              action: "render_view",
              view: "renderer",
              id: "kody-action.bound-plan.signature",
              rendererSlug: "approval-card",
              rendererName: "Approval card",
              resultTarget: "chat",
              ui: {
                type: "stack",
                children: [
                  {
                    type: "text",
                    value: "Apply daily CI monitoring?",
                    variant: "title",
                  },
                  {
                    type: "markdown",
                    value:
                      "Kody will reuse CI access, add one daily workflow, run it once, and verify the result.",
                  },
                  {
                    type: "row",
                    children: [
                      {
                        type: "button",
                        label: "Approve",
                        action: {
                          id: "approve",
                          label: "Approve",
                          response: "approve",
                          variant: "primary",
                        },
                      },
                      {
                        type: "button",
                        label: "Cancel",
                        action: {
                          id: "cancel",
                          label: "Cancel",
                          response: "cancel",
                          variant: "secondary",
                        },
                      },
                    ],
                  },
                ],
              },
              data: {},
            }
          : {
              content:
                "Configuration applied and verified. First run run-ci-1 succeeded: CI is green.",
            };
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          `data: ${JSON.stringify({
            type: "tool-input-available",
            toolCallId: `self-config-${turn}`,
            toolName: turn === 1 ? "configure_kody" : "final_answer",
            input: turn === 1 ? { outcome: "Daily CI monitoring" } : output,
          })}\n\n` +
          `data: ${JSON.stringify({
            type: "tool-output-available",
            toolCallId: `self-config-${turn}`,
            output,
          })}\n\n` +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      });
    });

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");
    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    await chat
      .locator("textarea")
      .first()
      .fill("Check this repository's CI every morning and report failures.");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByText("Apply daily CI monitoring?", { exact: true }),
    ).toBeVisible();
    await chat.getByRole("button", { name: "Approve" }).click();
    await expect(
      chat.getByText(
        "Configuration applied and verified. First run run-ci-1 succeeded: CI is green.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 15_000 });
    expect(turn).toBe(2);
  });

  test("shows an explicit cross-repository copy approval and verified completion", async ({
    page,
  }) => {
    let turn = 0;
    await page.route("**/api/kody/chat/kody", async (route) => {
      turn += 1;
      const output =
        turn === 1
          ? {
              action: "render_view",
              view: "renderer",
              id: "copy-capability.bound-plan.signature",
              rendererSlug: "approval-card",
              rendererName: "Approval card",
              resultTarget: "chat",
              ui: {
                type: "stack",
                children: [
                  {
                    type: "text",
                    value:
                      "Copy prepare-facebook-post from acme/source to acme/target?",
                    variant: "title",
                  },
                  {
                    type: "markdown",
                    value:
                      "Kody will copy the complete Capability and verify the saved target.",
                  },
                  {
                    type: "row",
                    children: [
                      {
                        type: "button",
                        label: "Approve",
                        action: {
                          id: "approve",
                          label: "Approve",
                          response: "approve",
                          variant: "primary",
                        },
                      },
                      {
                        type: "button",
                        label: "Cancel",
                        action: {
                          id: "cancel",
                          label: "Cancel",
                          response: "cancel",
                          variant: "secondary",
                        },
                      },
                    ],
                  },
                ],
              },
              data: {},
            }
          : {
              content:
                "Copied prepare-facebook-post from acme/source to acme/target and verified the saved target.",
            };
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          `data: ${JSON.stringify({
            type: "tool-input-available",
            toolCallId: `copy-capability-${turn}`,
            toolName: turn === 1 ? "copy_capability" : "final_answer",
            input:
              turn === 1
                ? {
                    source: { owner: "acme", repo: "source" },
                    target: { owner: "acme", repo: "target" },
                    slug: "prepare-facebook-post",
                    overwrite: false,
                  }
                : output,
          })}\n\n` +
          `data: ${JSON.stringify({
            type: "tool-output-available",
            toolCallId: `copy-capability-${turn}`,
            output,
          })}\n\n` +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      });
    });

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");
    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    await chat
      .locator("textarea")
      .first()
      .fill(
        "Copy prepare-facebook-post from acme/source to acme/target exactly.",
      );
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByText(
        "Copy prepare-facebook-post from acme/source to acme/target?",
        { exact: true },
      ),
    ).toBeVisible();
    await chat.getByRole("button", { name: "Approve" }).click();
    await expect(
      chat.getByText(
        "Copied prepare-facebook-post from acme/source to acme/target and verified the saved target.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 15_000 });
    expect(turn).toBe(2);
  });

  test("shows a clear warning when the selected model cannot use operation tools", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"error","errorText":"[trace a1b2c3d4] No endpoints found that support tool use"}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    const input = chat.locator("textarea").first();
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill("remove the package release workflow");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByText(
        "This model could not complete the requested operation with the available tools. Choose another model and try again. (trace a1b2c3d4)",
        { exact: false },
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows delegated specialist work in Thought and keeps the answer clean", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"started","agentTitle":"Agency Specialist","task":"Explain AI Agency structure."}}\n\n' +
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"reasoning","agentTitle":"Agency Specialist","reasoningDelta":"I compared each configured "}}\n\n' +
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"reasoning","agentTitle":"Agency Specialist","reasoningDelta":"Agency model and its responsibility."}}\n\n' +
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"completed","agentTitle":"Agency Specialist"}}\n\n' +
          'data: {"type":"text-delta","delta":"Agency has seven focused models."}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");

    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");

    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    const input = chat.locator("textarea").first();
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill("Explain AI Agency structure.");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByRole("button", { name: /Agency Specialist completed/ }),
    ).toBeVisible({ timeout: 15_000 });
    await chat
      .getByRole("button", { name: /Agency Specialist completed/ })
      .click();
    await expect(
      chat.getByRole("button", { name: /Agency Specialist/ }),
    ).toHaveCount(2);
    await expect(
      chat.getByRole("button", { name: /💭 Thought/ }),
    ).toBeVisible();
    await chat.getByRole("button", { name: /💭 Thought/ }).click();
    await expect(
      chat.getByText(
        "I compared each configured Agency model and its responsibility.",
      ),
    ).toBeVisible();
    await expect(
      chat.getByText("Agency has seven focused models."),
    ).toBeVisible();
    await expect(chat.getByText(/Kody delegated this request/)).toHaveCount(0);
    await expect(
      chat.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
    await expect(chat.getByRole("button", { name: "Stop run" })).toHaveCount(0);
  });

  test("a completed specialist without an answer settles visibly and restores the composer", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"started","agentTitle":"Agency Specialist","task":"Explain Agency."}}\n\n' +
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"completed","agentTitle":"Agency Specialist"}}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");
    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    const input = chat.locator("textarea").first();
    await input.fill("Explain Agency.");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(chat.getByText(/no response/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      chat.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
    await expect(chat.getByRole("button", { name: "Stop run" })).toHaveCount(0);
  });

  test("shows the specialist failure reason and does not remain thinking", async ({
    page,
  }) => {
    await page.route("**/api/kody/chat/kody", async (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"started","agentTitle":"Agency Specialist","task":"Explain AI Agency structure."}}\n\n' +
          'data: {"type":"data-subagent-activity","data":{"id":"agency-1","phase":"failed","agentTitle":"Agency Specialist","errorText":"The specialist timed out. Retry or choose another model. (trace a1b2c3d4)"}}\n\n' +
          'data: {"type":"text-delta","delta":"Agency Specialist failed: The specialist timed out. Retry or choose another model. (trace a1b2c3d4)"}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      }),
    );

    await page.goto(chatUrl());
    await page.waitForLoadState("domcontentloaded");
    const viewport = await page.viewportSize();
    if ((viewport?.width ?? 1280) < 768)
      test.skip(true, "chat hidden on mobile");
    await selectKodyAgent(page);

    const chat = page.locator('[aria-label="Kody chat"]');
    const input = chat.locator("textarea").first();
    await expect(input).toBeEditable({ timeout: 10_000 });
    await input.fill("Explain AI Agency structure.");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByRole("button", { name: /Agency Specialist failed/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      chat.getByText(
        "Agency Specialist failed: The specialist timed out. Retry or choose another model. (trace a1b2c3d4)",
      ),
    ).toBeVisible();
    await expect(chat.getByText("Thinking…", { exact: true })).toHaveCount(0);

    await chat
      .getByRole("button", { name: /Agency Specialist failed/ })
      .click();
    const specialistCard = chat.getByRole("button", {
      name: /^❌ Agency Specialist/,
    });
    await specialistCard.click();
    await expect(
      specialistCard
        .locator("..")
        .getByText(/The specialist timed out\. Retry or choose another model/),
    ).toBeVisible();
  });
});
