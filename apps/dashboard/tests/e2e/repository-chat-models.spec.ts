import { expect, test, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("shows repository chat models to a repository user", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "repo-model-user", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
  });
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "repo-model-user", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("https://api.github.com/user", (route) =>
    json(route, { login: "repo-model-user", avatar_url: "", id: 1 }),
  );
  await page.route("**/api/kody/chat/machines**", (route) =>
    json(route, { machines: [] }),
  );
  await page.route("**/api/kody/model-services", (route) =>
    json(route, { status: "stopped" }),
  );
  await page.route("**/api/kody/engine-models", (route) =>
    json(route, { models: [], automatic: {} }),
  );
  await page.route("**/api/kody/models**", (route) =>
    json(route, {
      models: [
        {
          id: "personal::shared/model",
          label: "Personal model",
          enabled: true,
          scope: "personal",
        },
        {
          id: "repo::shared/model",
          label: "Repository model",
          enabled: true,
          scope: "repo",
        },
      ],
      automatic: {},
    }),
  );
  await page.route("**/api/kody/repository-models", (route) =>
    json(route, {
      models: [
        {
          id: "anthropic/repository-model",
          label: "Repository model",
          provider: "anthropic",
          protocol: "anthropic",
          baseURL: "https://api.anthropic.com/v1",
          modelName: "repository-model",
          apiKeySecret: "ANTHROPIC_API_KEY",
          enabled: true,
          default: true,
        },
      ],
      automatic: {},
    }),
  );

  await page.goto(`${BASE_URL}/models`);
  await expect(
    page.getByRole("heading", { name: "Personal Chat Models" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Repo Chat", exact: true }).click();
  const repositoryModelsLink = page.getByRole("link", {
    name: "Repo Chat Models",
  });
  await expect(repositoryModelsLink).toBeVisible();
  await expect(repositoryModelsLink).toHaveAttribute(
    "href",
    "/repo/test-owner/test-repo/repository-models",
  );
  await repositoryModelsLink.click();

  await expect(
    page.getByRole("heading", { name: "Repository Chat Models" }),
  ).toBeVisible();
  await expect(
    page.getByText("Repository model", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OpenRouter Free", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(/shared with everyone using test-owner\/test-repo/),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Use Automatic as the Engine default" }),
  ).toHaveCount(0);

  await page.goto(`${BASE_URL}/repo/test-owner/test-repo/chat`);
  const chat = page.locator('[aria-label="Kody chat"]').first();
  const picker = chat.getByLabel("Chat setup").first();
  await expect(picker).toBeVisible({ timeout: 15_000 });
  const listbox = await openChatSetupSection(chat, "Model");
  await expect(
    listbox
      .locator('button[role="option"]')
      .filter({ hasText: "Personal model" }),
  ).toBeVisible();
  await expect(listbox.getByText("Personal · shared/model")).toBeVisible();
  await expect(
    listbox
      .locator('button[role="option"]')
      .filter({ hasText: "Repository model" }),
  ).toBeVisible();
  await expect(listbox.getByText("Repo · shared/model")).toBeVisible();
});
