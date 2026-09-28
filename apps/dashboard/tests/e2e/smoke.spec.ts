/**
 * @fileoverview Smoke layer: the key routes load and their core chrome
 * mounts. No deep interactions — this suite must stay fast (`pnpm
 * test:smoke`). Deep behavior lives in the e2e layer (admin-chat-regression,
 * client-chat-surface, chat-live-flow).
 *
 * @testFramework playwright
 * @domain smoke-mocked
 */

import { test, expect, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const auth = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "smoke-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(auth));
    localStorage.setItem(
      "kody-default-chat-entry:test-owner/test-repo",
      "kody:gpt-x",
    );
    localStorage.setItem("kody:chat-first-layout", "0");
  });
  await mockDashboardShellRequests(page);
}

test.describe("Route smoke", () => {
  test.beforeEach(async ({ page }) => {
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
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [{ id: "gpt-x", label: "GPT X", enabled: true }],
        }),
      }),
    );
    await seedAuth(page);
  });

  test("/ mounts the dashboard shell with the chat rail", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('[aria-label="Kody chat"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/chat mounts the admin chat with a composer", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`);
    await page.waitForLoadState("domcontentloaded");
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 15_000 });
    await expect(chat.locator("textarea").first()).toBeVisible();
  });

  test("Views loads a saved external website on localhost", async ({
    page,
  }) => {
    const websiteUrl = "https://preview.example.test";
    await page.unroute("**/api/kody/dashboard-config");
    await page.route("**/api/kody/dashboard-config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          config: {
            version: 1,
            namedPreviews: [
              { id: "production", label: "Production", url: websiteUrl },
            ],
          },
        }),
      }),
    );
    await page.route(`${websiteUrl}/`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>External preview</title>",
      }),
    );
    await page.route("**/api/kody/browser/session**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: "iframe", reason: "fly_not_configured" }),
      }),
    );

    await page.goto(`${BASE_URL}/repo/test-owner/test-repo/preview/production`);

    await expect(page.getByTitle("Preview deployment")).toHaveAttribute(
      "src",
      websiteUrl,
    );
    await expect(
      page.getByRole("link", { name: "Open preview in a new tab" }),
    ).toHaveAttribute("href", `${websiteUrl}/`);
    await expect(
      page.getByRole("link", { name: "Get inspector" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByTitle("Preview deployment")).toHaveAttribute(
      "src",
      websiteUrl,
    );
    await expect(
      page.getByText("External preview blocked on localhost"),
    ).toHaveCount(0);
  });

  test("a conversation route restores the same saved chat after refresh", async ({
    page,
  }) => {
    const conversationId = "conversation-linked";
    const otherConversationId = "conversation-other";
    const now = "2026-08-11T12:00:00.000Z";
    let detailReads = 0;
    await page.unroute("**/api/kody/chat/conversations**");
    await page.route("**/api/kody/chat/conversations**", (route) => {
      const url = new URL(route.request().url());
      const isCollection = url.pathname.endsWith("/conversations");
      if (isCollection) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            conversations: [
              {
                conversationId,
                title: "Persistent route conversation",
                preview: "Saved message from this conversation",
                pinned: false,
                activeAgent: { slug: "kody", title: "Kody" },
                runtime: { kind: "direct", modelId: "gpt-x" },
                machineAccess: "none",
                scope: {
                  kind: "repository",
                  owner: "test-owner",
                  repo: "test-repo",
                },
                createdAt: now,
                updatedAt: now,
              },
              {
                conversationId: otherConversationId,
                title: "Another saved conversation",
                preview: "Another saved message",
                pinned: false,
                activeAgent: { slug: "kody", title: "Kody" },
                runtime: { kind: "direct", modelId: "gpt-x" },
                machineAccess: "none",
                scope: {
                  kind: "repository",
                  owner: "test-owner",
                  repo: "test-repo",
                },
                createdAt: now,
                updatedAt: "2026-08-11T11:00:00.000Z",
              },
            ],
          }),
        });
      }
      if (route.request().method() === "GET") detailReads += 1;
      const requestedConversationId = url.pathname.split("/").at(-1)!;
      const isOtherConversation =
        requestedConversationId === otherConversationId;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversation: {
            conversationId: requestedConversationId,
            title: isOtherConversation
              ? "Another saved conversation"
              : "Persistent route conversation",
            pinned: false,
            activeAgent: { slug: "kody", title: "Kody" },
            runtime: { kind: "direct", modelId: "gpt-x" },
            machineAccess: "none",
            scope: {
              kind: "repository",
              owner: "test-owner",
              repo: "test-repo",
            },
            createdAt: now,
            updatedAt: now,
          },
          entries: [
            {
              entryId: "message-1",
              seq: 1,
              entry: {
                kind: "message",
                role: "user",
                content: isOtherConversation
                  ? "Another saved message"
                  : "Saved message from this conversation",
                status: "committed",
                createdAt: now,
              },
            },
          ],
          checkpoints: [],
        }),
      });
    });

    const sideChatUrl = `${BASE_URL}/repo/test-owner/test-repo/tasks`;
    await page.addInitScript((id) => {
      sessionStorage.setItem("kody-chat:active-session:global", id);
    }, otherConversationId);
    await page.goto(sideChatUrl);
    await expect(page.getByText("Another saved message").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(page.getByText("Another saved message").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('summary[aria-label="More compose options"]').click();
    await page.getByRole("button", { name: /^Terminal / }).click();
    await expect(page.getByLabel("Terminal target")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = sessionStorage.getItem(
            "kody-chat-terminal-v1:test-owner/test-repo",
          );
          if (!raw) return null;
          return JSON.parse(raw).modeBySessionId?.["conversation-other"];
        }),
      )
      .toBe("terminal");
    await page.reload();
    await expect(page.getByLabel("Terminal target")).toBeVisible();
    await expect(page).toHaveURL(sideChatUrl);
    await page.evaluate(() => {
      sessionStorage.removeItem("kody-chat-terminal-v1:test-owner/test-repo");
    });

    const conversationUrl = `${BASE_URL}/repo/test-owner/test-repo/chat/${conversationId}`;
    await page.goto(conversationUrl);
    await expect(
      page.getByText("Saved message from this conversation").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(conversationUrl);

    await page.reload();
    await expect(
      page.getByText("Saved message from this conversation").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(conversationUrl);
    expect(detailReads).toBeGreaterThanOrEqual(2);
  });

  test("/brands keeps the default dashboard page structure", async ({
    page,
  }) => {
    await page.route("**/api/kody/brands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          brands: [
            {
              slug: "acme",
              name: "Acme",
              accent: "#7c3aed",
              locale: "en",
              welcomeText: "Welcome to Acme",
              appearance: {
                colorScheme: "light",
                background: "#fffaf5",
                surface: "#ffffff",
                foreground: "#292524",
                mutedForeground: "#57534e",
                secondary: "#ede9fe",
                border: "#d6d3d1",
                userMessage: "#6d28d9",
                assistantMessage: "#f5f5f4",
                input: "#ffffff",
                fontSize: "large",
                radius: "rounded",
              },
              access: { mode: "public" },
              source: "repo",
              htmlUrl:
                "https://github.com/test-owner/test-repo/blob/main/brands/acme.json",
            },
          ],
        }),
      }),
    );

    await page.goto(`${BASE_URL}/brands`);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "Brands" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[aria-label="Kody chat"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("searchbox", { name: "Search brands" }),
    ).toBeVisible();
    // Client surfaces are repo-scoped now: /client/<owner>/<repo>/<slug>.
    await expect(
      page.getByRole("link", {
        name: "/client/test-owner/test-repo/acme",
      }),
    ).toHaveAttribute("href", "/client/test-owner/test-repo/acme");
    await expect(
      page.getByRole("link", { name: "Open Acme client surface" }).first(),
    ).toHaveAttribute("href", "/client/test-owner/test-repo/acme");
    await expect(
      page.getByRole("link", { name: "Open Acme client surface" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Acme", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Public surfaces")).toHaveCount(0);
    await expect(page.locator('[data-testid="chat-panel-brands"]')).toHaveCount(
      0,
    );
  });

  test("/themes manages each brand theme from its own page", async ({
    page,
  }) => {
    let savedTheme: Record<string, unknown> | null = null;
    await page.route("**/api/kody/brands", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          brands: [
            {
              slug: "acme",
              name: "Acme",
              accent: "#7c3aed",
              appearance: {
                colorScheme: "light",
                background: "#fffaf5",
                surface: "#ffffff",
                foreground: "#292524",
                mutedForeground: "#57534e",
                secondary: "#ede9fe",
                border: "#d6d3d1",
                userMessage: "#6d28d9",
                assistantMessage: "#f5f5f4",
                input: "#ffffff",
                fontSize: "large",
                radius: "rounded",
              },
              access: { mode: "public" },
              source: "repo",
            },
          ],
        }),
      }),
    );
    await page.route("**/api/kody/brands/acme", async (route) => {
      savedTheme = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ brand: { slug: "acme" } }),
      });
    });

    await page.goto(`${BASE_URL}/themes`);
    await expect(
      page.getByRole("heading", { name: "Client Themes", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("searchbox", { name: "Search themes" }),
    ).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Brand" })).toHaveValue(
      "acme",
    );
    await expect(page.getByLabel("Primary color", { exact: true })).toHaveValue(
      "#7c3aed",
    );
    await expect(
      page.getByLabel("Background color", { exact: true }),
    ).toHaveValue("#fffaf5");
    await expect(page.getByLabel("Text color", { exact: true })).toHaveValue(
      "#292524",
    );
    await expect(page.getByLabel("Surface color", { exact: true })).toHaveValue(
      "#ffffff",
    );
    await expect(
      page.getByLabel("Assistant message color", { exact: true }),
    ).toHaveValue("#f5f5f4");
    await expect(
      page.getByLabel("User message color", { exact: true }),
    ).toHaveValue("#6d28d9");
    await expect(
      page.getByRole("combobox", { name: "Chat text size" }),
    ).toHaveValue("large");
    await expect(
      page.getByRole("combobox", { name: "Corner style" }),
    ).toHaveValue("rounded");
    await expect(
      page.getByRole("group", { name: "Theme style" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByLabel("Theme preview")).toHaveCSS(
      "background-color",
      "rgb(255, 250, 245)",
    );
    await expect(
      page.getByRole("heading", { name: "How can we help?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save theme" }).click();
    await expect
      .poll(() => savedTheme)
      .toEqual({
        accent: "#7c3aed",
        appearance: {
          colorScheme: "light",
          background: "#fffaf5",
          surface: "#ffffff",
          foreground: "#292524",
          mutedForeground: "#57534e",
          secondary: "#ede9fe",
          border: "#d6d3d1",
          userMessage: "#6d28d9",
          assistantMessage: "#f5f5f4",
          input: "#ffffff",
          fontSize: "large",
          radius: "rounded",
        },
        actorLogin: "smoke-e2e",
      });

    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Dark", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Theme preview")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await expect(page.getByLabel("Theme preview")).toHaveCSS(
      "background-color",
      "rgb(10, 16, 30)",
    );
    await expect(page.getByLabel("Surface color", { exact: true })).toHaveValue(
      "#111827",
    );

    await expect(
      page.getByRole("button", { name: "Client", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("link", { name: "Client Themes" }),
    ).toBeVisible();
  });
});
