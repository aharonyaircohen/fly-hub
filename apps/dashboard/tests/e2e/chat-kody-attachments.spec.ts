/**
 * @fileoverview Browser contract for canonical conversation attachments.
 * Verifies upload-before-message, multimodal transport, and server-backed
 * rehydration after a full page reload.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const CHAT_URL = `${BASE_URL}/repo/test-owner/test-repo/chat`;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_BUFFER = Buffer.from(PNG_BASE64, "base64");

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: {
          login: "attachment-e2e",
          avatar_url: "",
          id: 1,
        },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:test/model",
    );
  });
}

test("stores attachment with the conversation and restores it after reload", async ({
  page,
}) => {
  await mockKodyAccountSession(page, {
    id: "attachment-e2e",
    name: "Attachment E2E",
  });
  const now = new Date().toISOString();
  const state = {
    conversationId: "",
    uploaded: false,
    entries: [] as Array<{
      entryId: string;
      seq: number;
      entry: Record<string, unknown>;
    }>,
  };
  let capturedTurn: Record<string, unknown> | null = null;

  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  await page.route("**/api/kody/agents**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agent: [] }),
    }),
  );
  await page.route(
    /\/api\/kody\/chat\/conversations\/[^/]+\/attachments\/attachment-1$/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG_BUFFER,
      }),
  );
  await page.route(
    /\/api\/kody\/chat\/conversations\/[^/]+\/attachments$/,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      state.uploaded = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "attachment-1",
          name: "pixel.png",
          mimeType: "image/png",
          size: PNG_BUFFER.length,
        }),
      });
    },
  );
  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "GET" &&
      pathname.endsWith("/attachments/attachment-1")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG_BUFFER,
      });
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/attachments")) {
      state.uploaded = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "attachment-1",
          name: "pixel.png",
          mimeType: "image/png",
          size: PNG_BUFFER.length,
        }),
      });
      return;
    }
    const isCollection = pathname.endsWith("/conversations");
    const isCommand = pathname.endsWith("/commands");
    if (request.method() === "GET" && isCollection) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversations: state.conversationId
            ? [
                {
                  conversationId: state.conversationId,
                  title: "New conversation",
                  pinned: false,
                  activeAgent: { slug: "kody", title: "Kody" },
                  runtime: { kind: "direct", modelId: "test/model" },
                  createdAt: now,
                  updatedAt: now,
                },
              ]
            : [],
        }),
      });
      return;
    }
    if (request.method() === "POST" && isCollection) {
      state.conversationId = request.postDataJSON().conversationId;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ conversationId: state.conversationId }),
      });
      return;
    }
    if (request.method() === "POST" && isCommand) {
      const command = request.postDataJSON();
      if (command.kind === "append-message") {
        if (command.role === "user") {
          expect(state.uploaded).toBe(true);
          expect(command.attachmentIds).toEqual(["attachment-1"]);
        }
        if (!state.entries.some((entry) => entry.entryId === command.entryId)) {
          state.entries.push({
            entryId: command.entryId,
            seq: state.entries.length,
            entry: {
              kind: "message",
              role: command.role,
              content: command.content,
              status: command.status,
              attachmentIds: command.attachmentIds,
              createdAt: command.createdAt,
            },
          });
        }
      } else if (command.kind === "update-message") {
        const stored = state.entries.find(
          (entry) => entry.entryId === command.entryId,
        );
        if (stored) {
          stored.entry.content = command.content;
          stored.entry.status = command.status;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversation: {
          conversationId: state.conversationId,
          title: "New conversation",
          pinned: false,
          activeAgent: { slug: "kody", title: "Kody" },
          runtime: { kind: "direct", modelId: "test/model" },
          createdAt: now,
          updatedAt: now,
        },
        entries: state.entries,
        checkpoints: [],
        runtimeBindings: [],
        attachments: state.uploaded
          ? [
              {
                attachment: {
                  attachmentId: "attachment-1",
                  fileName: "pixel.png",
                  mediaType: "image/png",
                  sizeBytes: PNG_BUFFER.length,
                },
              },
            ]
          : [],
      }),
    });
  });
  await page.route("**/api/kody/chat/kody", async (route) => {
    capturedTurn = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        'data: {"type":"text-delta","delta":"I see your image."}\n\n' +
        'data: {"type":"finish"}\n\n',
    });
  });

  await seedAuth(page);
  await page.goto(CHAT_URL);
  const chat = page.locator('[aria-label="Kody chat"]').first();
  const modelMenu = await openChatSetupSection(chat, "Model");
  await modelMenu
    .locator('button[role="option"]')
    .filter({ hasText: "Kody Test" })
    .click();

  await chat.locator('input[type="file"]').last().setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: PNG_BUFFER,
  });
  await expect(chat.getByText("pixel.png", { exact: false })).toBeVisible();
  await chat.locator("textarea").fill("what is this?");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect(chat.getByText("I see your image.")).toBeVisible();

  expect(capturedTurn).not.toBeNull();
  const messages = (
    capturedTurn as unknown as {
      messages: Array<{ role: string; content: unknown }>;
    }
  ).messages;
  const user = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  expect(Array.isArray(user?.content)).toBe(true);
  expect(user?.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "what is this?" }),
      expect.objectContaining({
        type: "image",
        image: expect.stringMatching(/^data:image\/png;base64,/),
        mimeType: "image/png",
      }),
    ]),
  );

  await page.reload();
  await expect(
    chat.getByText("what is this?", { exact: false }).last(),
  ).toBeVisible();
  await expect(chat.getByText("I see your image.").last()).toBeVisible();
  await expect(chat.locator('img[alt="pixel.png"]').last()).toBeVisible();
});
