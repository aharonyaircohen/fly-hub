import { expect, test, type Route } from "@playwright/test";
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

test("creates and reloads a Guided Flow", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.addInitScript(
    (value) => window.localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      return json(route, { definitions: saved ? [saved] : [] });
    }
    const body = route.request().postDataJSON() as {
      draft: Record<string, unknown>;
    };
    saved = { id: "release-check", version: 1, ...body.draft };
    return json(route, { definition: saved }, 201);
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Guided Flows" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();
  await page.getByLabel("Flow name").fill("Release check");
  await page.getByRole("button", { name: "Save Guided Flow" }).click();
  await expect(
    page.getByRole("article", { name: "Release check" }),
  ).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  const article = page.getByRole("article", { name: "Release check" });
  await article.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Flow name")).toHaveValue("Release check");
});

test("shows a Blueprint-generated Guided Flow as read-only", async ({
  page,
}) => {
  await page.addInitScript(
    (value) => window.localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/guided-flows**", (route) =>
    json(route, {
      definitions: [
        {
          id: "prepare-release",
          version: 2,
          title: "Prepare release",
          source: {
            type: "request-blueprint",
            id: "prepare-release",
            version: 2,
          },
          steps: [
            {
              id: "target",
              title: "Choose target",
              explanation: "Choose the release target.",
              rendererSlug: "guided-form",
              actions: [{ id: "submit", target: { type: "complete" } }],
            },
          ],
        },
      ],
    }),
  );

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  const article = page.getByRole("article", { name: "Prepare release" });
  await expect(article.getByText("Generated", { exact: true })).toBeVisible();
  await expect(
    article.getByRole("button", { name: "Edit Prepare release" }),
  ).toHaveCount(0);
});
