import { expect, test, type Page, type Route } from "@playwright/test";

import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "capability-e2e";
const REPO = "workspace";
const SLUG = "inspect";

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
          token: "capability-token",
          user: { login: "capability-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
}

test("Capabilities open as folders in the shared Files workspace", async ({
  page,
}) => {
  const failures: string[] = [];
  let savedInstructions: string | null = null;
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(
        `response: ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });
  await seedAuth(page);
  await mockDashboardShellRequests(page);

  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "capability-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/capabilities", (route) =>
    json(route, {
      capabilities: [{ slug: SLUG, describe: "Inspect a change." }],
    }),
  );
  await page.route(`**/api/kody/capabilities/${SLUG}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        instructions: string;
      };
      savedInstructions = body.instructions;
      return json(route, {
        capability: {
          slug: SLUG,
          describe: "Inspect a change.",
          instructions: body.instructions,
          contract: JSON.stringify({ input: {}, output: {} }, null, 2),
          skills: [{ name: "review.md", content: "Review carefully." }],
          capabilityTools: [{ name: "check.sh", content: "echo checked" }],
        },
      });
    }
    return json(route, {
      capability: {
        slug: SLUG,
        describe: "Inspect a change.",
        instructions: "# Inspect\n\nInspect the supplied request.",
        contract: JSON.stringify({ input: {}, output: {} }, null, 2),
        skills: [{ name: "review.md", content: "Review carefully." }],
        capabilityTools: [{ name: "check.sh", content: "echo checked" }],
      },
    });
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [] }),
  );
  await page.route("**/api/kody/agents", (route) => json(route, { agent: [] }));
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [], turns: [] }),
  );
  await page.route("**/api/kody/system-events", (route) =>
    json(route, { events: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/capabilities`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(1_000);
  expect(failures).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Capabilities" }),
  ).toBeVisible();
  const tree = page.getByRole("tree");
  await expect(tree.getByText(SLUG, { exact: true })).toBeVisible();
  await tree.evaluate((element) => {
    element.setAttribute("data-workspace-instance", "stable");
  });
  await tree.getByText(SLUG, { exact: true }).click();
  await expect(tree).toHaveAttribute("data-workspace-instance", "stable");
  await expect(
    tree.getByText("instructions.md", { exact: true }),
  ).toBeVisible();
  await expect(tree.getByText("contract.json", { exact: true })).toBeVisible();
  await expect(tree.getByText("skills", { exact: true })).toBeVisible();
  await expect(tree.getByText("tools", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run as Kody" })).toBeVisible();

  await tree.getByText("instructions.md", { exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Editor content" });
  await editor.click({ force: true });
  await editor.press("ControlOrMeta+A");
  await editor.press("Backspace");
  await page.keyboard.insertText("# Inspect\n\nUse the shared Files editor.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(() => savedInstructions)
    .toContain("Use the shared Files editor.");
});
