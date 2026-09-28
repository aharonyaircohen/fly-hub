import { test, expect } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

test("the existing Kody chat sends through Hermes and shows its reply", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockDashboardShellRequests(page);
  await page.addInitScript(() => {
    localStorage.setItem("kody_auth", JSON.stringify({
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "hermes-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    }));
  });
  await page.route("**/api/kody/hermes/models", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ provider: "minimax", model: "MiniMax-M3", providers: [
      { slug: "minimax", name: "MiniMax", models: ["MiniMax-M3"] },
    ] }),
  }));
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/kody/hermes/sessions**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/sessions") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessions: [] }) });
    }
    if (url.pathname.endsWith("/sessions") && method === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        id: "stored-1", stored_session_id: "stored-1", session_id: "runtime-1",
      }) });
    }
    if (url.pathname.endsWith("/chat/stream") && method === "POST") {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" },
        body: 'event: assistant.delta\ndata: {"delta":"Hello from Hermes"}\n\n' +
          'event: assistant.completed\ndata: {"content":"Hello from Hermes","status":"complete"}\n\n',
      });
    }
    if (url.pathname.endsWith("/stored-1") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        session: { id: "stored-1", title: "Hermes chat" }, history: { messages: [] },
      }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto(`${BASE_URL}/chat`);
  const chat = page.locator('[aria-label="Kody chat"]').first();
  await expect(chat).toBeVisible();
  await expect(page.locator('[data-testid="kody-chat-root"]')).toHaveCount(1);
  await expect(chat.getByText("Conversations").first()).toBeVisible();
  await expect(chat.getByLabel("Chat setup").first()).toHaveAttribute("title", /MiniMax/i);
  await chat.locator("textarea").first().fill("hello");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect(chat.getByText("Hello from Hermes", { exact: true })).toBeVisible();
  expect(sent).toMatchObject({
    message: "hello", runtimeSessionId: "runtime-1", model: "minimax/MiniMax-M3",
  });
  await chat.getByRole("button", { name: "Restore chat width" }).click();
  await expect(page).toHaveURL(/\/tasks/);
  await expect(chat.getByText("Hello from Hermes", { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "Expand chat fullscreen" }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(chat.getByText("Hello from Hermes", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
