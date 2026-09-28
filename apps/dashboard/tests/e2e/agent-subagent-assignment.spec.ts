import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "agents-e2e";
const REPO = "workspace";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function seedAuth(page: Page) {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "agents-token",
          user: { login: "agents-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
}

test("user assigns a public Agent as Kody's subagent", async ({ page }) => {
  const failures: string[] = [];
  let savedSubagents: string[] = [];
  const agents: Array<{
    slug: string;
    title: string;
    body: string;
    whenToUse?: string;
    subagents?: string[];
    lockedSubagents?: string[];
    source?: "local" | "builtin" | "store";
    readOnly?: boolean;
    updatedAt: string;
    htmlUrl: string;
  }> = [
    {
      slug: "kody",
      title: "Kody",
      body: "Coordinates the team.",
      subagents: ["context-scout"],
      lockedSubagents: ["context-scout"],
      source: "builtin",
      readOnly: true,
      updatedAt: "",
      htmlUrl: "",
    },
    {
      slug: "context-scout",
      title: "Context Scout",
      body: "Finds relevant context.",
      whenToUse: "Use for memory, documentation, and context.",
      source: "builtin",
      readOnly: true,
      updatedAt: "",
      htmlUrl: "",
    },
    {
      slug: "agency-specialist",
      title: "Agency Specialist",
      body: "Manages the AI Agency.",
      whenToUse: "Use for Agency configuration and governance.",
      updatedAt: "2026-08-01T00:00:00.000Z",
      htmlUrl: "",
    },
  ];

  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  await seedAuth(page);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(
      route,
      route.request().method() === "GET" ? { conversations: [] } : {},
    ),
  );

  await page.route("**/api/kody/agents**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return json(route, { agent: agents });
    if (request.method() === "PATCH") {
      const body = request.postDataJSON() as { subagents?: string[] };
      savedSubagents = body.subagents ?? [];
      agents[0] = { ...agents[0]!, subagents: savedSubagents };
      return json(route, { agentMember: agents[0] });
    }
    return json(route, { error: "unexpected_request" }, 500);
  });
  await page.route("**/api/kody/capabilities", (route) =>
    json(route, { capabilities: [] }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "agents-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/webhooks/register", (route) =>
    json(route, { success: true }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/agents/kody`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Kody" })).toBeVisible();
  const chatContext = page.getByTestId("chat-context-bar");
  await expect(chatContext.getByTestId("chat-context-title")).toHaveText(
    "New conversation",
  );
  await expect(chatContext.getByText("Kody", { exact: true })).toHaveCount(0);
  await expect(chatContext.getByText("kody", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Configure specialists" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Configure Kody specialists",
  });
  await expect(dialog).toContainText("Subagents");
  await expect(
    dialog.getByRole("checkbox", { name: "Assign Context Scout as subagent" }),
  ).toBeDisabled();
  await dialog.getByText("Agency Specialist", { exact: true }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect
    .poll(() => savedSubagents)
    .toEqual(["context-scout", "agency-specialist"]);
  expect(failures).toEqual([]);
});

test("code-owned Kody shows its seven assigned built-in specialists", async ({
  page,
}) => {
  const failures: string[] = [];
  const specialistSlugs = [
    "context-scout",
    "cto",
    "repository-analyst",
    "operations-specialist",
    "agency-specialist",
    "system-admin",
    "ui-vibe-specialist",
  ];
  const agents = [
    {
      slug: "kody",
      title: "Kody",
      body: "Coordinates focused specialist work.",
      subagents: specialistSlugs,
      lockedSubagents: specialistSlugs,
      source: "builtin",
      readOnly: true,
      updatedAt: "",
      htmlUrl: "",
    },
    ...specialistSlugs.map((slug) => ({
      slug,
      title: slug
        .split("-")
        .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
        .join(" "),
      body: `Owns ${slug} work.`,
      whenToUse: `Use for ${slug} work.`,
      source: "builtin",
      readOnly: true,
      updatedAt: "",
      htmlUrl: "",
    })),
  ];

  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  await seedAuth(page);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [] }),
  );
  await page.route("**/api/kody/agents**", (route) =>
    json(route, { agent: agents }),
  );
  await page.route("**/api/kody/capabilities", (route) =>
    json(route, { capabilities: [] }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "agents-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/webhooks/register", (route) =>
    json(route, { success: true }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/agents/kody`, {
    waitUntil: "domcontentloaded",
  });
  const kodyDetail = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Kody", exact: true }),
  });
  await expect(kodyDetail).toBeVisible();
  for (const slug of specialistSlugs) {
    await expect(kodyDetail.getByText(slug)).toBeVisible();
  }
  await expect(page.getByText("Built-in", { exact: true })).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Delete agent" })).toHaveCount(
    0,
  );

  expect(failures).toEqual([]);
});
