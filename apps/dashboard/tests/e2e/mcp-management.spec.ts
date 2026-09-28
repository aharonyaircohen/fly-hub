/** @testFramework playwright @domain e2e-mocked */
import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

async function seedRepository(page: Page) {
  await page.addInitScript(() => {
    const repo = {
      repoUrl: "https://github.com/test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
      token: "ghp_placeholder",
      user: { login: "mcp-e2e", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    };
    localStorage.setItem("kody_auth", JSON.stringify(repo));
  });
}

test("creates, verifies, and revokes an agent-agnostic MCP connection", async ({
  page,
}) => {
  await mockDashboardShellRequests(page);
  await seedRepository(page);

  let tokens: Array<Record<string, unknown>> = [];
  let createdBody: Record<string, unknown> | undefined;
  await page.route("**/api/kody/mcp/tokens", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tokens }),
      });
    }
    if (method === "POST") {
      expect(route.request().headers()).toMatchObject({
        "x-kody-token": "ghp_placeholder",
        "x-kody-owner": "test-owner",
        "x-kody-repo": "test-repo",
      });
      createdBody = route.request().postDataJSON();
      const token = {
        tokenId: "11111111-1111-4111-8111-111111111111",
        name: createdBody?.name,
        scopes:
          createdBody?.access === "read"
            ? ["mcp:read"]
            : ["mcp:read", "mcp:execute"],
        createdAt: "2026-09-04T12:00:00.000Z",
        expiresAt: "2026-10-04T12:00:00.000Z",
      };
      tokens = [token];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "kody_mcp_one_time_secret",
          token,
        }),
      });
    }
    tokens = [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/kody/mcp", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dashboard-check",
        result: {
          isError: false,
          structuredContent: {
            status: "ready",
            repository: "test-owner/test-repo",
          },
          content: [],
        },
      }),
    }),
  );

  await page.goto("/repo/test-owner/test-repo/mcp");
  await expect(
    page.getByRole("heading", { name: "Agent connections" }),
  ).toBeVisible();
  await expect(page.getByText("Works with any MCP client")).toBeVisible();
  await expect(page.getByText(/Claude|Codex|OpenCode|Hermes/)).toHaveCount(0);

  await page.getByRole("button", { name: "Create connection" }).click();
  await page.getByLabel("Connection name").fill("My coding agent");
  await page.getByLabel("Access", { exact: true }).selectOption("read");
  await page.getByRole("button", { name: "Create token" }).click();

  expect(createdBody).toMatchObject({
    name: "My coding agent",
    access: "read",
    memoryScope: "repository",
    allowMemoryDelete: false,
  });
  await expect(page.getByText("Connection ready")).toBeVisible();
  await expect(page.getByText("kody_mcp_one_time_secret")).toBeVisible();
  await expect(page.getByText(/KODY_MCP_TOKEN/).first()).toBeVisible();
  await expect(page.getByText(/\/api\/kody\/mcp/).first()).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("kody_mcp_one_time_secret")).toHaveCount(0);
  await expect(page.getByText("My coding agent")).toBeVisible();

  await page.getByRole("button", { name: "Revoke My coding agent" }).click();
  await expect(page.getByText("No agent connections yet")).toBeVisible();
});
