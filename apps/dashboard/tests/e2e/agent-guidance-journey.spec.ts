import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "guidance-e2e";
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
          token: "guidance-token",
          user: { login: "guidance-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
}

test("user creates, assigns, and deletes agent guidance", async ({ page }) => {
  const failures: string[] = [];
  const stores = {
    constraints: new Map<
      string,
      {
        slug: string;
        body: string;
        agent: string[];
        sha: string;
        updatedAt: string;
        htmlUrl: string;
      }
    >(),
    policies: new Map<
      string,
      {
        slug: string;
        body: string;
        agent: string[];
        sha: string;
        updatedAt: string;
        htmlUrl: string;
      }
    >(),
  };

  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  await seedAuth(page);
  await mockDashboardShellRequests(page);

  await page.route("**/api/kody/{constraints,policies}**", async (route) => {
    const url = new URL(route.request().url());
    const kind = url.pathname.includes("/constraints")
      ? "constraints"
      : "policies";
    const store = stores[kind];
    const prefix = `/api/kody/${kind}`;
    const slug = decodeURIComponent(
      url.pathname.slice(prefix.length).replace(/^\//, ""),
    );
    const method = route.request().method();
    if (!slug && method === "GET")
      return json(route, { entries: [...store.values()] });
    if (!slug && method === "POST") {
      const body = route.request().postDataJSON() as {
        slug: string;
        body: string;
        agent: string[];
      };
      const entry = {
        ...body,
        sha: "",
        updatedAt: new Date().toISOString(),
        htmlUrl: "",
      };
      store.set(body.slug, entry);
      return json(route, { entry });
    }
    const entry = store.get(slug);
    if (method === "GET")
      return entry
        ? json(route, { entry })
        : json(route, { error: "not_found" }, 404);
    if (method === "PATCH" && entry) {
      const body = route.request().postDataJSON() as {
        body?: string;
        agent?: string[];
      };
      const updated = {
        ...entry,
        ...body,
        updatedAt: new Date().toISOString(),
      };
      store.set(slug, updated);
      return json(route, { entry: updated });
    }
    if (method === "DELETE" && entry) {
      store.delete(slug);
      return json(route, { success: true });
    }
    return json(route, { error: "not_found" }, 404);
  });
  await page.route("**/api/kody/agents", (route) =>
    json(route, {
      agent: [
        { slug: "kody", title: "Kody", body: "", updatedAt: "t", htmlUrl: "" },
        {
          slug: "qa-engineer",
          title: "QA Engineer",
          body: "",
          updatedAt: "t",
          htmlUrl: "",
        },
      ],
    }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "guidance-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/navigation-favorites", (route) =>
    json(route, { favoriteHrefs: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [], turns: [] }),
  );
  await page.route("**/api/kody/system-events", (route) =>
    json(route, { events: [] }),
  );
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [] }),
  );

  await page.goto(`/repo/${OWNER}/${REPO}/constraints`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Constraints" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Constraints writing guide" }).click();
  await expect(
    page.getByText("Write hard limits the assigned agents must never cross."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "New file" }).click();
  const createDialog = page.getByRole("dialog", { name: "New file" });
  await createDialog.getByPlaceholder("Constraint name").fill("no-force-push");
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => stores.constraints.has("no-force-push")).toBe(true);

  await page.getByRole("button", { name: "Assign agents" }).click();
  await page.getByRole("menuitemcheckbox", { name: "qa-engineer" }).click();
  await expect
    .poll(() => stores.constraints.get("no-force-push")?.agent)
    .toEqual(["kody", "qa-engineer"]);

  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete file" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect.poll(() => stores.constraints.has("no-force-push")).toBe(false);

  await page.goto(`/repo/${OWNER}/${REPO}/policies`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  await page.getByRole("button", { name: "Policies writing guide" }).click();
  await expect(
    page.getByText(
      "Write repeatable decision rules for choosing among allowed actions.",
    ),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
