import { expect, test, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "live-agent-e2e";
const REPO = "workspace";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("user makes an Agent live and manages its Loop", async ({ page }) => {
  const failures: string[] = [];
  const writes: Array<Record<string, unknown>> = [];
  let live = false;
  let paused = false;
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "token",
          user: { login: "operator", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
  await mockDashboardShellRequests(page);
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`response: ${response.status()} ${response.url()}`);
  });

  await page.route(
    "**/api/kody/agents/operations-agent/live",
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        return json(route, {
          status: {
            agent: "operations-agent",
            live,
            paused,
            intent: live ? "healthy-operations" : null,
            schedule: live ? "1h" : null,
            loopId: "live-agent-operations-agent",
            state: live
              ? {
                  revision: 0,
                  cursor: "",
                  summary: "",
                  updatedAt: "2026-08-19T00:00:00.000Z",
                }
              : null,
            consistency: live ? "ready" : "inactive",
          },
        });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (body.action === "activate") live = true;
      if (body.action === "pause") paused = true;
      if (body.action === "resume") paused = false;
      return json(route, { status: { live, paused } });
    },
  );
  await page.route("**/api/kody/agents", (route) =>
    json(route, {
      agent: [
        {
          slug: "operations-agent",
          title: "Operations Agent",
          body: "Keep systems healthy.",
          updatedAt: "2026-08-19T00:00:00.000Z",
          htmlUrl: "",
          source: "local",
        },
      ],
    }),
  );
  await page.route("**/api/kody/intents", (route) =>
    json(route, {
      entries: [
        { slug: "healthy-operations", body: "Keep production healthy." },
      ],
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [
        { id: "openrouter/free", label: "OpenRouter Free", enabled: true },
      ],
    }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "operator", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [] }),
  );
  await page.route("**/api/webhooks/register", (route) =>
    json(route, { success: true }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/agents/operations-agent`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Not live" })).toBeVisible();
  await page.getByRole("button", { name: "Start live Agent" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Make Operations Agent live",
  });
  await dialog.getByLabel("Primary Intent").click();
  await page.getByRole("option", { name: "healthy-operations" }).click();
  await dialog.getByRole("button", { name: "Make live" }).click();

  await expect(page.getByRole("heading", { name: "Live" })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(2);
  await expect(page.getByText("No activity yet")).toBeVisible();
  await expect
    .poll(() => writes[0])
    .toEqual({ action: "activate", intent: "healthy-operations", every: "1h" });
  await page.getByRole("button", { name: "Pause live Agent" }).click();
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  expect(writes[1]).toEqual({ action: "pause" });
  expect(failures).toEqual([]);
});
