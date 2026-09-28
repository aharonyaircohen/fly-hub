import { expect, test, type Page, type Route } from "@playwright/test";

import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function openMobileChatIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) return;
  const openChat = page.getByRole("button", { name: "Open chat" });
  await expect(openChat).toBeVisible();
  await openChat.click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (value) => localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [] }),
  );
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/agents", (route) => json(route, { agent: [] }));
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const isCollection = new URL(route.request().url()).pathname.endsWith(
      "/conversations",
    );
    return json(route, isCollection ? { conversations: [] } : { ok: true });
  });
});

test("offers setup and starts the built-in Init Engine flow in Chat", async ({
  page,
}) => {
  let startedFlowId: string | null = null;
  await page.route("**/api/kody/engine/status", (route) =>
    json(route, {
      status: "setup_required",
      files: { workflow: "missing", config: "missing" },
    }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "POST") {
      startedFlowId = route.request().postDataJSON().flowId ?? null;
      return json(route, {
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "init-engine-start",
          rendererSlug: "approval-card",
          rendererName: "Approval card",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "init-engine-instance",
            stepId: "prepare",
            revision: 0,
          },
          ui: {
            type: "stack",
            children: [
              {
                type: "text",
                value: "Prepare the repository",
                variant: "title",
              },
            ],
          },
          data: { title: "Prepare the repository" },
        },
      });
    }
    return json(route, { flows: [], definitions: [] });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await openMobileChatIfNeeded(page);

  const openingRenderer = page
    .getByTestId("chat-assistant-message")
    .filter({ hasText: "Hi! I can help you with:" })
    .filter({ has: page.getByRole("button", { name: "Setup Kody" }) });
  await expect(openingRenderer).toHaveCount(1);
  await expect(openingRenderer).toContainText("Hi! I can help you with:");
  await expect(
    page.getByText("Kody is not set up in this repository"),
  ).toHaveCount(0);
  await openingRenderer.getByRole("button", { name: "Setup Kody" }).click();

  await expect(page).toHaveURL("/repo/acme/widgets/chat");
  await expect.poll(() => startedFlowId).toBe("initialize-kody-engine");
  await expect(page.getByText("Prepare the repository")).toBeVisible();
});

test("stays quiet when the repository is ready", async ({ page }) => {
  await page.route("**/api/kody/engine/status", (route) =>
    json(route, {
      status: "ready",
      files: { workflow: "present", config: "present" },
    }),
  );

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await openMobileChatIfNeeded(page);

  await expect(
    page.getByRole("button", { name: "Setup Kody" }),
  ).toHaveCount(0);
});
