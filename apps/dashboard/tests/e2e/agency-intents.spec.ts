import { expect, test, type Page, type Route } from "@playwright/test";

const OWNER = "agency-e2e";
const REPO = "workspace";

interface IntentEntry {
  slug: string;
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

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
          token: "agency-token",
          user: {
            login: "agency-e2e",
            avatar_url: "https://github.com/github.png",
            id: 1,
          },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
}

async function mockSharedRequests(page: Page) {
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: {
        login: "agency-e2e",
        avatar_url: "https://github.com/github.png",
        githubId: 1,
      },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [], turns: [] }),
  );
  await page.route("**/api/kody/navigation-favorites", (route) =>
    json(route, { favoriteHrefs: [] }),
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
}

function entry(slug: string, body: string): IntentEntry {
  return {
    slug,
    body,
    sha: "",
    updatedAt: "2026-07-25T12:00:00.000Z",
    htmlUrl: "",
  };
}

test("Intents uses the file workspace for multiple markdown intents", async ({
  page,
  isMobile,
}) => {
  const failures: string[] = [];
  const intents = new Map([
    ["reliable-delivery", entry("reliable-delivery", "# Reliable delivery")],
    ["simple-product", entry("simple-product", "# Simple product")],
  ]);
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  await seedAuth(page);
  await mockSharedRequests(page);
  await page.route("**/api/kody/intents/**", async (route) => {
    const slug = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop() ?? "",
    );
    if (route.request().method() === "DELETE") {
      intents.delete(slug);
      return json(route, { success: true });
    }
    const current = intents.get(slug);
    if (!current) return json(route, { error: "not_found" }, 404);
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { body: string };
      const updated = entry(slug, body.body);
      intents.set(slug, updated);
      return json(route, { entry: updated });
    }
    return json(route, { entry: current });
  });
  await page.route("**/api/kody/intents", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        slug: string;
        body: string;
      };
      const created = entry(body.slug, body.body || `# ${body.slug}\n`);
      intents.set(body.slug, created);
      return json(route, { entry: created });
    }
    return json(route, { entries: [...intents.values()] });
  });

  await page.goto(`/repo/${OWNER}/${REPO}/agency`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByRole("heading", { name: "Intents" })).toBeVisible();
  await expect(
    page.getByRole("tree").getByText("reliable-delivery.md", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tree").getByText("simple-product.md", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("menuitem", { name: "New file" }).click();
  const createDialog = page.getByRole("dialog", { name: "New file" });
  await createDialog.getByPlaceholder("Intent name").fill("secure-defaults");
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => intents.has("secure-defaults")).toBe(true);

  if (!isMobile) {
    await page
      .getByRole("tree")
      .getByText("secure-defaults.md", { exact: true })
      .click();
    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: "Delete file" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect.poll(() => intents.has("secure-defaults")).toBe(false);
  }
  expect(failures).toEqual([]);
});
