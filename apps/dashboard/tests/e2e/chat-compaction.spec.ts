import { expect, test, type Page } from "@playwright/test";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const REPO_KEY = "test-owner/test-repo";
const SESSION_ID = "compaction-e2e-session";

async function seedLongConversation(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ({ repoKey }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: "https://github.com/test-owner/test-repo",
          owner: "test-owner",
          repo: "test-repo",
          token: "ghp_placeholder",
          user: { login: "compaction-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
      localStorage.setItem(
        `kody-default-chat-entry:${repoKey}`,
        "kody:test/model",
      );
    },
    { repoKey: REPO_KEY },
  );
}

async function mockLongConversationPersistence(
  page: Page,
  onCommand: (command: Record<string, unknown>) => void,
): Promise<void> {
  const now = new Date().toISOString();
  const conversation = {
    conversationId: SESSION_ID,
    scope: { kind: "repository", owner: "test-owner", repo: "test-repo" },
    title: "Long conversation",
    pinned: false,
    activeAgent: { slug: "kody", title: "Kody" },
    runtime: { kind: "direct", modelId: "test/model" },
    machineAccess: "none",
    createdAt: now,
    updatedAt: now,
  };
  const entries = Array.from({ length: 20 }, (_, index) => ({
    entryId: `message-${index}`,
    seq: index,
    entry: {
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      content:
        (index === 0 ? "OLD_VISIBLE_MARKER " : `message-${index} `) +
        "working context ".repeat(625),
      status: "committed",
      createdAt: now,
    },
  }));

  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname.endsWith("/conversations")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [conversation] }),
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversation,
          entries,
          checkpoints: [],
          attachments: [],
        }),
      });
      return;
    }
    const command = request.postDataJSON() as Record<string, unknown>;
    onCommand(command);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function selectKodyAgent(page: Page) {
  const chat = page.locator('[aria-label="Kody chat"]');
  const trigger = chat.getByLabel("Chat setup").first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  if (/Kody Test/i.test((await trigger.getAttribute("title")) ?? "")) return;
  const menu = await openChatSetupSection(chat, "Model");
  await menu.getByRole("button", { name: /Kody Test/i }).click();
  await expect(trigger).toHaveAttribute("title", /Kody Test/i);
}

test("compacts model context while keeping the visible conversation", async ({
  page,
}, testInfo) => {
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );

  let compactCalls = 0;
  let directBody: Record<string, unknown> | null = null;
  let savedCheckpointSummary: unknown = null;
  await mockLongConversationPersistence(page, (command) => {
    if (command.kind === "checkpoint") {
      savedCheckpointSummary = command.summary;
    }
  });
  await page.route("**/api/kody/chat/compact", async (route) => {
    compactCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary: "The earlier working context." }),
    });
  });
  await page.route("**/api/kody/chat/kody", async (route) => {
    directBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        'data: {"type":"text-delta","delta":"Compaction reply"}\n\n' +
        "data: [DONE]\n\n",
    });
  });

  await seedLongConversation(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");

  const chat = page.locator('[aria-label="Kody chat"]');
  const input = chat.locator("textarea").first();
  await expect(input).toBeEditable({ timeout: 15_000 });
  await selectKodyAgent(page);
  await expect(page.getByText(/OLD_VISIBLE_MARKER/).first()).toBeAttached();

  await input.fill("continue after compaction");
  await chat.getByRole("button", { name: "Send message" }).click();

  const status = page.getByTestId("conversation-compaction-status");
  await expect(status).toContainText("Compacting conversation");
  await expect.poll(() => compactCalls).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("compacting-conversation.png"),
    fullPage: false,
  });
  await expect(status).toContainText("Conversation compacted", {
    timeout: 10_000,
  });
  await expect(page.getByText("Compaction reply").first()).toBeVisible();

  await expect(page.getByText(/OLD_VISIBLE_MARKER/).first()).toBeAttached();
  expect(directBody).toMatchObject({
    conversationSummary: "The earlier working context.",
  });
  expect(JSON.stringify(directBody)).not.toContain("OLD_VISIBLE_MARKER");

  await expect
    .poll(() => savedCheckpointSummary)
    .toBe("The earlier working context.");
});

test("manually compacts from the composer menu", async ({ page }, testInfo) => {
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  let compactCalls = 0;
  let savedCheckpointSummary: unknown = null;
  await mockLongConversationPersistence(page, (command) => {
    if (command.kind === "checkpoint") {
      savedCheckpointSummary = command.summary;
    }
  });
  await page.route("**/api/kody/chat/compact", async (route) => {
    compactCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary: "Manual composer memory." }),
    });
  });

  await seedLongConversation(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");

  const chat = page.locator('[aria-label="Kody chat"]');
  await expect(chat.locator("textarea").first()).toBeEditable({
    timeout: 15_000,
  });
  await selectKodyAgent(page);
  await chat.getByLabel("More compose options").click();
  const compactButton = chat.getByRole("button", {
    name: "Compact conversation",
  });
  await expect(compactButton).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("composer-compact-menu.png"),
    fullPage: false,
  });
  await compactButton.click();

  const status = page.getByTestId("conversation-compaction-status");
  await expect(status).toContainText("Compacting conversation");
  await expect.poll(() => compactCalls).toBe(1);
  await expect(status).toContainText("Conversation compacted", {
    timeout: 10_000,
  });
  await expect(page.getByText(/OLD_VISIBLE_MARKER/).first()).toBeAttached();
  await expect
    .poll(() => savedCheckpointSummary)
    .toBe("Manual composer memory.");
});
