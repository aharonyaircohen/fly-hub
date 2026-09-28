/**
 * @fileoverview Browser contract for the current chat picker boundary.
 * AI Agency agents and chat models are separate controls.
 *
 * @testFramework playwright
 * @domain e2e-mocked
 */

import { test, expect, type Page } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const CHAT_URL = `${BASE_URL}/repo/test-owner/test-repo/chat`;

function sseBody(events: unknown[]): string {
  return (
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const auth = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "chat-picker-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
      // Legacy configuration must not reintroduce internal picker entries.
      brain: { url: "https://brain.example.test", apiKey: "brain-key-123" },
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "brain",
    );
    localStorage.removeItem("kody-sessions-v3:test-owner/test-repo");
    localStorage.removeItem("kody-sessions-v3");
  });
}

test.describe("Chat picker backend boundary", () => {
  test.beforeEach(async ({ page }) => {
    await mockKodyAccountSession(page, {
      id: "chat-picker-e2e",
      name: "Chat Picker E2E",
    });
    await page.route("**/api/kody/agents", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent: [
            {
              slug: "research",
              title: "Research",
              body: "Research agent",
              updatedAt: "",
              htmlUrl: "",
            },
            {
              slug: "ux",
              title: "UX",
              body: "UX agent",
              updatedAt: "",
              htmlUrl: "",
            },
            {
              slug: "ceo",
              title: "CEO",
              body: "CEO agent",
              updatedAt: "",
              htmlUrl: "",
            },
          ],
        }),
      }),
    );
    await page.route(/\/api\/kody\/agents\/[^/?]+(?:\?.*)?$/, async (route) => {
      const slug = route.request().url().split("/").pop();
      const known = {
        research: "Research",
        ux: "UX",
        ceo: "CEO",
      } as const;
      const title = known[slug as keyof typeof known];
      if (!title) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_found" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agentMember: {
            slug,
            title,
            body: `${title} agent`,
            updatedAt: "",
            htmlUrl: "",
          },
        }),
      });
    });
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "openai/gpt-5", label: "Kody Test", enabled: true }],
        }),
      }),
    );
    await page.route("**/api/kody/brain/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              id: "personal-codex",
              name: "Personal Codex",
              runtime: "codex app-server",
              enabled: true,
              default: true,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/kody/chat/machines", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ local: false }),
      }),
    );
    await page.route("**/api/kody/chat/conversations**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const isCollection = pathname.endsWith("/conversations");
      if (request.method() === "GET" && isCollection) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ conversations: [] }),
        });
        return;
      }
      await route.fulfill({
        status: request.method() === "POST" && isCollection ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          request.method() === "GET"
            ? {
                conversation: null,
                entries: [],
                checkpoints: [],
                runtimeBindings: [],
                attachments: [],
              }
            : { ok: true },
        ),
      });
    });
    await seedAuth(page);
  });

  test("keeps Personal Codex visible and selects its Brain machine", async ({
    page,
  }) => {
    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const setup = chat.getByLabel("Chat setup").first();

    const modelMenu = await openChatSetupSection(chat, "Model");
    const personalCodex = modelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Personal Codex" });
    await expect(personalCodex).toBeVisible();
    await personalCodex.click();

    await expect(setup).toHaveAttribute("title", /Personal Codex.*Brain/);
  });

  test("keeps agent, model, and machine selection separate", async ({
    page,
  }) => {
    await page.goto(CHAT_URL);
    await expect(page).toHaveURL(CHAT_URL);

    const chat = page.locator('[aria-label="Kody chat"]').first();
    const title = chat.getByTestId("chat-context-bar");
    await expect(title).toContainText("Global chat — not tied to any task");
    const setup = chat.getByLabel("Chat setup").first();
    await expect(setup).toBeVisible({ timeout: 15_000 });
    await expect(setup).toHaveAttribute("title", /OpenRouter Free/);
    const menu = await openChatSetupSection(chat, "Agency agent");
    await expect(
      menu.locator('button[role="option"]').filter({ hasText: "Kody" }),
    ).toBeVisible();
    await expect(
      menu.locator('button[role="option"]').filter({ hasText: "Research" }),
    ).toBeVisible();
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeHidden();

    const agentMenu = await openChatSetupSection(chat, "Agency agent");
    await agentMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Research" })
      .click();
    await expect(setup).toHaveAttribute("title", /Research/);
    await expect(title).toContainText("Global chat — not tied to any task");

    const modelMenu = await openChatSetupSection(chat, "Model");
    await expect(
      modelMenu.locator('button[role="option"]').filter({
        hasText: "Kody Test",
      }),
    ).toBeVisible();
    await expect(
      modelMenu.locator('button[role="option"]').filter({
        hasText: "Personal Codex",
      }),
    ).toBeVisible();
    await expect(
      modelMenu.locator('button[role="option"]').filter({
        hasText: "Kody Live",
      }),
    ).toBeVisible();
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await expect(modelMenu).toBeHidden();

    const reopenedModelMenu = await openChatSetupSection(chat, "Model");
    await reopenedModelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Kody Test" })
      .click();

    const effortMenu = await openChatSetupSection(chat, "Effort");
    await expect(effortMenu).toBeVisible();
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await expect(effortMenu).toBeHidden();

    const codexModelMenu = await openChatSetupSection(chat, "Model");
    await codexModelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Personal Codex" })
      .click();
    await expect(setup).toHaveAttribute("title", /Personal Codex.*Brain/);

    const brainModelMenu = await openChatSetupSection(chat, "Model");
    await expect(
      brainModelMenu
        .locator('button[role="option"]')
        .filter({ hasText: "Personal Codex" }),
    ).toBeVisible();
    await expect(
      brainModelMenu.locator('button[role="option"]').filter({
        hasText: "Kody Test",
      }),
    ).toBeVisible();
    await expect(
      brainModelMenu.locator('button[role="option"]').filter({
        hasText: "Kody Live",
      }),
    ).toBeVisible();
    await expect(
      brainModelMenu.locator('button[role="option"]').filter({
        hasText: "OpenRouter Free",
      }),
    ).toBeVisible();
    await expect(
      brainModelMenu.locator('button[role="option"]').filter({
        hasText: "Kody Brain",
      }),
    ).toHaveCount(0);
  });

  test("shows the message and starts the model before storage responds", async ({
    page,
  }) => {
    let releaseSave!: () => void;
    const saveBlocked = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(
      /\/api\/kody\/chat\/conversations\/[^/]+\/commands$/,
      async (route) => {
        const command = route.request().postDataJSON();
        if (command.kind === "append-message" && command.role === "user") {
          await saveBlocked;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );
    await page.route("**/api/kody/chat/kody", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody([
          {
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          },
          {
            type: "tool-input-available",
            toolCallId: "saved-reply",
            toolName: "final_answer",
            input: { content: "Saved reply" },
          },
          {
            type: "tool-output-available",
            toolCallId: "saved-reply",
            output: { content: "Saved reply" },
          },
          { type: "finish" },
        ]),
      }),
    );

    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const modelMenu = await openChatSetupSection(chat, "Model");
    await modelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Kody Test" })
      .click();

    const composer = chat.locator("textarea").first();
    await composer.fill("Immediate user bubble");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(
      chat.getByText("Immediate user bubble", { exact: true }),
    ).toBeVisible({ timeout: 1_000 });
    await expect(chat.getByText("Saved reply")).toBeVisible({
      timeout: 1_000,
    });
    releaseSave();
  });

  test("shows Local only when the host enables it and sends the selection", async ({
    page,
  }) => {
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/kody/chat/machines", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ local: true }),
      }),
    );
    await page.route("**/api/kody/chat/kody", (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody([
          { type: "text-delta", delta: "Local reply" },
          { type: "finish" },
        ]),
      });
    });

    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const setup = chat.getByLabel("Chat setup").first();
    const machineMenu = await openChatSetupSection(chat, "Machine");
    await machineMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Local" })
      .click();
    await expect(setup).toHaveAttribute("title", /Local/);
    await page.locator("body").click({ position: { x: 4, y: 4 } });

    await chat.locator("textarea").first().fill("inspect this machine");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText("Local reply")).toBeVisible();
    expect(requestBody).toMatchObject({ machineAccess: "local" });
  });

  test("keeps the model response visible when storage fails", async ({
    page,
  }) => {
    await page.route(
      /\/api\/kody\/chat\/conversations\/[^/]+\/commands$/,
      async (route) => {
        const command = route.request().postDataJSON();
        await route.fulfill({
          status:
            command.kind === "append-message" && command.role === "user"
              ? 500
              : 200,
          contentType: "application/json",
          body: JSON.stringify(
            command.kind === "append-message" && command.role === "user"
              ? { error: "storage_failed" }
              : { ok: true },
          ),
        });
      },
    );
    await page.route("**/api/kody/chat/kody", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sseBody([
          {
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          },
          {
            type: "tool-input-available",
            toolCallId: "save-failure-reply",
            toolName: "final_answer",
            input: { content: "Reply despite save failure" },
          },
          {
            type: "tool-output-available",
            toolCallId: "save-failure-reply",
            output: { content: "Reply despite save failure" },
          },
          { type: "finish" },
        ]),
      }),
    );

    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const modelMenu = await openChatSetupSection(chat, "Model");
    await modelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Kody Test" })
      .click();

    const composer = chat.locator("textarea").first();
    await composer.fill("Storage may fail");
    await chat.getByRole("button", { name: "Send message" }).click();

    await expect(chat.getByText("Reply despite save failure")).toBeVisible();
  });

  test("persists an agent handoff and sends it as identity context", async ({
    page,
  }) => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const stored = {
      conversation: null as null | Record<string, unknown>,
      entries: [] as Array<{
        entryId: string;
        seq: number;
        entry: Record<string, unknown>;
      }>,
    };
    await page.route("**/api/kody/chat/conversations**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const commandRoute = url.pathname.endsWith("/commands");
      const baseRoute = url.pathname.endsWith("/conversations");
      if (request.method() === "GET" && baseRoute) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            conversations: stored.conversation ? [stored.conversation] : [],
          }),
        });
        return;
      }
      if (request.method() === "POST" && baseRoute) {
        const input = request.postDataJSON();
        const now = new Date().toISOString();
        stored.conversation = {
          conversationId: input.conversationId,
          title: input.title,
          pinned: false,
          activeAgent: input.activeAgent,
          runtime: input.runtime,
          createdAt: now,
          updatedAt: now,
        };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ conversationId: input.conversationId }),
        });
        return;
      }
      if (request.method() === "POST" && commandRoute) {
        const command = request.postDataJSON();
        if (command.kind === "set-agent" && stored.conversation) {
          stored.conversation.activeAgent = command.agent;
        } else if (command.kind === "handoff" && stored.conversation) {
          stored.entries.push({
            entryId: command.entryId,
            seq: stored.entries.length,
            entry: {
              kind: "agent-handoff",
              from: command.from,
              to: command.to,
              createdAt: command.createdAt,
            },
          });
          stored.conversation.activeAgent = command.to;
        } else if (command.kind === "append-message") {
          stored.entries.push({
            entryId: command.entryId,
            seq: stored.entries.length,
            entry: {
              kind: "message",
              role: command.role,
              content: command.content,
              status: command.status,
              createdAt: command.createdAt,
            },
          });
        } else if (command.kind === "update-message") {
          const entry = stored.entries.find(
            (item) => item.entryId === command.entryId,
          );
          if (entry) {
            entry.entry.content = command.content;
            entry.entry.status = command.status;
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
          conversation: stored.conversation,
          entries: stored.entries,
          checkpoints: [],
          runtimeBindings: [],
          attachments: [],
        }),
      });
    });
    await page.route("**/api/kody/chat/kody", async (route) => {
      requestBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "text-delta", delta: "Agent reply" },
          { type: "finish" },
        ]),
      });
    });

    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const setup = chat.getByLabel("Chat setup").first();
    await expect(setup).toBeVisible({ timeout: 15_000 });
    await expect(setup).toHaveAttribute("title", /OpenRouter Free/);

    const modelMenu = await openChatSetupSection(chat, "Model");
    await modelMenu
      .locator('button[role="option"]')
      .filter({ hasText: "Kody Test" })
      .click();
    await expect(setup).toHaveAttribute("title", /Kody · Kody Test/);

    const agentMenu = await openChatSetupSection(chat, "Agency agent");
    await agentMenu
      .locator('button[role="option"]')
      .filter({ hasText: "UX" })
      .click();
    await expect(setup).toHaveAttribute("title", /UX/);

    const composer = chat.locator("textarea").first();
    await composer.fill("Who are you?");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText("Agent reply")).toBeVisible();

    const nextAgentMenu = await openChatSetupSection(chat, "Agency agent");
    await nextAgentMenu
      .locator('button[role="option"]')
      .filter({ hasText: "CEO" })
      .click();
    await expect(chat.getByTestId("agent-handoff")).toHaveText("UX → CEO");

    await composer.fill("Who are you now?");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => requestBodies.length).toBe(2);

    expect(requestBodies[1]?.agentSlug).toBe("ceo");
    expect(requestBodies[1]?.agentHandoff).toEqual({
      id: expect.any(String),
      fromSlug: "ux",
      fromTitle: "UX",
      toSlug: "ceo",
      toTitle: "CEO",
      switchedAt: expect.any(String),
    });
    expect(requestBodies[1]?.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Who are you now?" }),
    ]);
    expect(requestBodies[1]?.agentHandoffContext).toContain(
      "user: Who are you?",
    );
    expect(requestBodies[1]?.agentHandoffContext).toContain(
      "assistant: Agent reply",
    );

    await expect
      .poll(() => stored.conversation?.activeAgent)
      .toEqual({ slug: "ceo", title: "CEO" });
    expect(stored.entries).toContainEqual(
      expect.objectContaining({
        entry: expect.objectContaining({
          kind: "agent-handoff",
          to: { slug: "ceo", title: "CEO" },
        }),
      }),
    );
    await page.reload();
    await expect(chat.getByTestId("agent-handoff")).toHaveText("UX → CEO");
    await expect(setup).toHaveAttribute("title", /CEO/);
  });

  test("keeps the current agent when server validation fails", async ({
    page,
  }) => {
    await page.route("**/api/kody/agents/ceo", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_found" }),
      }),
    );
    await page.goto(CHAT_URL);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    const setup = chat.getByLabel("Chat setup").first();

    const agentMenu = await openChatSetupSection(chat, "Agency agent");
    await agentMenu
      .locator('button[role="option"]')
      .filter({ hasText: "CEO" })
      .click();

    await expect(setup).not.toHaveAttribute("title", /ceo/);
    await expect(chat.getByTestId("agent-handoff")).toHaveCount(0);
    await expect(page.getByText("Could not switch to CEO")).toBeVisible();
  });
});
