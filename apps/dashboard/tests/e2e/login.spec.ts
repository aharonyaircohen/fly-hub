/**
 * @fileoverview First-run private Chat and optional repository setup E2E tests.
 * @testFramework playwright
 * @domain e2e
 *
 * The dashboard no longer has a dedicated /login route. First-run auth lives in
 * the root dashboard shell as a user sign-in form.
 */

import { test, expect, type Page } from "@playwright/test";

const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/aharonyaircohen/kody-chat";

test.use({ serviceWorkers: "block" });

async function loadWithoutAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    if (sessionStorage.getItem("kody_e2e_auth_cleared") === null) {
      localStorage.removeItem("kody_auth");
      sessionStorage.setItem("kody_e2e_auth_cleared", "true");
    }
  });
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
}

async function loadUserWithoutRepo(page: Page): Promise<void> {
  await page.evaluate(() =>
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "",
        owner: "",
        repo: "",
        token: "ghp_mock_token",
        user: { login: "e2e-test", avatar_url: "avatar", id: 1 },
        loggedInAt: Date.now(),
        repos: [],
        currentRepoIndex: -1,
      }),
    ),
  );
  await page.goto("/repo/test-owner/test-repo/tasks");
}

test.describe("Repository setup", () => {
  test.beforeEach(async ({ page }) => {
    await loadWithoutAuth(page);
  });

  test("renders private user sign-in before repository setup", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /welcome to kody/i }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder(/github personal access token/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start private chat/i }),
    ).toBeVisible();
  });

  test("starts a contextless private Chat", async ({ page }) => {
    let startedFlowId: string | null = null;
    await page.route("**/api/kody/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: { login: "alice", avatar_url: "avatar", githubId: 42 },
        }),
      }),
    );
    await page.route("**/api/kody/chat/conversations**", async (route) => {
      const isCollection = new URL(route.request().url()).pathname.endsWith(
        "/conversations",
      );
      await route.fulfill({
        status: route.request().method() === "POST" && isCollection ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          isCollection ? { conversations: [] } : { ok: true },
        ),
      });
    });
    await page.route("**/api/kody/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      }),
    );
    await page.route("**/api/kody/guided-flows**", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ flows: [], definitions: [] }),
        });
      }
      const body = route.request().postDataJSON() as { flowId?: string };
      startedFlowId = body.flowId ?? null;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          instance: { instanceId: "onboarding-user", status: "active" },
          compatibility: { status: "compatible" },
          view: {
            action: "render_view",
            view: "renderer",
            id: "onboarding-user-0",
            rendererSlug: "approval-card",
            rendererName: "Approval card",
            resultTarget: "guided-flow",
            guidedFlow: {
              instanceId: "onboarding-user",
              stepId: "welcome",
              revision: 0,
            },
            ui: {
              type: "stack",
              children: [
                {
                  type: "text",
                  value: "Your private Chat is ready",
                  variant: "title",
                },
                {
                  type: "row",
                  children: [
                    {
                      type: "button",
                      label: "Start chatting",
                      action: {
                        id: "finish",
                        label: "Start chatting",
                        response: "finish",
                        variant: "primary",
                      },
                    },
                  ],
                },
              ],
            },
            data: {
              title: "Your private Chat is ready",
              actions: [
                {
                  id: "finish",
                  label: "Start chatting",
                  response: "finish",
                  variant: "primary",
                },
              ],
            },
          },
        }),
      });
    });
    await page.getByPlaceholder(/github personal access token/i).fill("pat");
    await page.getByRole("button", { name: /start private chat/i }).click();
    await expect(page).toHaveURL(/\/chat(?:\?|$)/);
    await expect.poll(() => startedFlowId).toBe("onboarding");
    await expect(
      page.getByText("Your private Chat is ready").first(),
    ).toBeVisible();
    await expect(page.locator('a[href^="/repo//"]')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem("kody_auth"));
    expect(JSON.parse(stored!).repos).toEqual([]);
    await expect(
      page.locator('[aria-label="Kody chat"]:visible'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("shows validation error for invalid repository input", async ({
    page,
  }) => {
    await loadUserWithoutRepo(page);
    await page.getByLabel(/^repository$/i).fill("not-a-valid-repo-url");
    await page.getByRole("button", { name: /add repository/i }).click();

    await expect(page.getByText(/enter a github url/i)).toBeVisible();
  });

  test("shows API error for rejected token", async ({ page }) => {
    await loadUserWithoutRepo(page);
    await page.route("**/api/kody/repos/add", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_token",
          message: "GitHub rejected token (401). Check PAT and try again.",
        }),
      });
    });

    await page.getByLabel(/^repository$/i).fill(TEST_REPO);
    await page.getByRole("button", { name: /add repository/i }).click();

    await expect(page.getByText(/github rejected token/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /add repository/i }),
    ).toBeEnabled({ timeout: 15_000 });
  });

  test("stores auth after repository connects", async ({ page }) => {
    await loadUserWithoutRepo(page);
    await page.route("**/api/kody/repos/add", async (route) => {
      const body = route.request().postDataJSON() as {
        owner: string;
        repo: string;
        token: string;
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          owner: body.owner,
          repo: body.repo,
          repository: {
            fullName: `${body.owner}/${body.repo}`,
            private: false,
            defaultBranch: "main",
            htmlUrl: `https://github.com/${body.owner}/${body.repo}`,
          },
          user: {
            login: "e2e-test",
            avatar_url: "https://github.com/github.png",
            id: 1,
          },
          webhook: { ok: true, created: false },
        }),
      });
    });

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.getByLabel(/^repository$/i).fill(TEST_REPO);
    await page.getByRole("button", { name: /add repository/i }).click();

    const authHandle = await page.waitForFunction(() =>
      localStorage.getItem("kody_auth"),
    );
    const rawAuth = await authHandle.jsonValue();
    expect(rawAuth).not.toBeNull();

    const repoUrl = new URL(TEST_REPO);
    const [expectedOwner, expectedRepo] = repoUrl.pathname
      .replace(/^\//, "")
      .split("/");

    const parsed = JSON.parse(String(rawAuth));
    expect(parsed.owner).toBe(expectedOwner);
    expect(parsed.repo).toBe(expectedRepo);
    expect(parsed.token).toBe("ghp_mock_token");
    expect(parsed.repos).toHaveLength(1);

    const jsErrors = errors.filter(
      (e) =>
        !e.includes("Extension context invalidated") &&
        !e.includes("chrome-extension") &&
        !e.includes("Failed to load resource"),
    );
    expect(jsErrors).toHaveLength(0);
  });
});
