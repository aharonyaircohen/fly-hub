import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const OWNER = "test-owner";
const REPO = "test-repo";

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ owner, repo }) => {
      if (!localStorage.getItem("kody_auth")) {
        localStorage.setItem(
          "kody_auth",
          JSON.stringify({
            repoUrl: `https://github.com/${owner}/${repo}`,
            owner,
            repo,
            token: "ghp_trigger_e2e",
            user: { login: "trigger-e2e", avatar_url: "", id: 1 },
            loggedInAt: Date.now(),
            repos: [
              {
                repoUrl: `https://github.com/${owner}/${repo}`,
                owner,
                repo,
                token: "ghp_trigger_e2e",
                user: {
                  login: "trigger-e2e",
                  avatar_url: "",
                  id: 1,
                },
                addedAt: Date.now(),
                isLogin: true,
              },
            ],
            currentRepoIndex: 0,
          }),
        );
      }
    },
    { owner: OWNER, repo: REPO },
  );
}

test("user selects the GitHub source workflow and Kody target workflow", async ({
  page,
}) => {
  const errors: string[] = [];
  let savedTrigger: Record<string, unknown> | null = null;
  const patUpdateAttempts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });

  await seedAuth(page);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: { login: "trigger-e2e", avatar_url: "", githubId: 1 },
        owner: OWNER,
        repo: REPO,
      }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ conversations: [] }),
    }),
  );
  const emptyResponses = {
    commands: { commands: [] },
    agents: { agent: [] },
    models: { models: [] },
    "guided-flows": { flows: [] },
  } as const;
  for (const path of Object.keys(emptyResponses) as Array<
    keyof typeof emptyResponses
  >) {
    await page.route(`**/api/kody/${path}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyResponses[path]),
      }),
    );
  }
  await page.route("**/api/kody/triggers", async (route) => {
    if (route.request().method() === "POST") {
      savedTrigger = route.request().postDataJSON().trigger;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ triggers: [] }),
    });
  });
  await page.route("**/api/kody/user-state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        namespaces: [
          { name: "selections", origin: "core", modelWritable: true },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/github/workflows", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            id: 12,
            name: "Repo Hygiene Report (Daily)",
            path: ".github/workflows/repo-hygiene-report.yml",
            state: "active",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/company/workflows", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            id: "review-ci",
            workflow: { name: "Review CI" },
            runnable: true,
            automation: { eligible: true },
          },
          {
            id: "release-with-approval",
            workflow: { name: "Release with approval" },
            runnable: true,
            automation: {
              eligible: false,
              reason: "approval-required",
            },
          },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/repos/add", async (route) => {
    const body = route.request().postDataJSON() as {
      owner: string;
      repo: string;
      token: string;
    };
    patUpdateAttempts.push(body.token);
    if (body.token === "bad_token") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "invalid_token",
          message: "GitHub rejected the token.",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        owner: body.owner,
        repo: body.repo,
        repository: {
          fullName: `${body.owner}/${body.repo}`,
          private: true,
          defaultBranch: "main",
          htmlUrl: `https://github.com/${body.owner}/${body.repo}`,
        },
        user: {
          login: "replacement-user",
          avatar_url: "https://example.com/avatar.png",
          id: 2,
        },
        webhook: { ok: true, created: false },
        backgroundAccess: { ok: true, source: "encrypted-pat" },
      }),
    });
  });

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/triggers`);
  await expect(page.getByText("No triggers yet")).toBeVisible();
  await page.getByRole("button", { name: /new trigger/i }).click();

  await expect(page.getByText("When", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Trigger" }).click();
  await page.getByRole("option", { name: "A chat session starts" }).click();
  await expect(page.getByRole("combobox", { name: "Action" })).toContainText(
    "Save event data",
  );
  await page.getByRole("combobox", { name: "Action" }).click();
  await expect(
    page.getByRole("option", { name: "Save event data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Start a Kody workflow" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("combobox", { name: "Trigger" }).click();
  await page.getByRole("option", { name: "GitHub workflow finishes" }).click();
  await expect(
    page.getByRole("combobox", { name: "GitHub workflow", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "GitHub workflow", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Repo Hygiene Report (Daily)" })
    .click();

  await expect(page.getByText("Then", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Action" })).toContainText(
    "Start a Kody workflow",
  );
  await page.getByRole("combobox", { name: "Action" }).click();
  await expect(
    page.getByRole("option", { name: "Save event data" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "Start a Kody workflow" }).click();
  await page.getByRole("combobox", { name: "Kody workflow to start" }).click();
  await page.getByRole("option", { name: /Review CI/ }).click();
  await expect(
    page.getByRole("option", { name: /Release with approval/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("More filters and input mapping (optional)"),
  ).toHaveCount(0);

  await page.getByLabel("Name").fill("Start review after hygiene");
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => savedTrigger)
    .toMatchObject({
      event: "github.workflow_run.completed",
      action: {
        type: "start-workflow",
        workflowId: "review-ci",
      },
      conditions: [{ path: "workflowId", op: "equals", value: 12 }],
    });
  await expect(page.getByText("Use a different trigger")).toHaveCount(0);
  await expect(page.getByText("When GitHub workflow")).toHaveCount(0);

  await page.getByTitle("Switch repository").click();
  await page
    .getByRole("button", {
      name: `Update PAT for ${OWNER}/${REPO}`,
    })
    .click();
  const patDialog = page.getByRole("dialog", { name: "Update PAT" });
  const patInput = patDialog.getByLabel("New personal access token");
  await expect(patInput).toHaveAttribute("type", "password");

  await patInput.fill("bad_token");
  await patDialog.getByRole("button", { name: "Save" }).click();
  await expect(patDialog.getByText("GitHub rejected the token.")).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kody_auth") ?? "null"),
    ),
  ).toMatchObject({ token: "ghp_trigger_e2e" });

  await patInput.fill("ghp_replacement_e2e");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    patDialog.getByRole("button", { name: "Save" }).click(),
  ]);
  await expect
    .poll(() => patUpdateAttempts)
    .toEqual(["bad_token", "ghp_replacement_e2e"]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("kody_auth") ?? "null"),
    ),
  ).toMatchObject({
    token: "ghp_replacement_e2e",
    user: { login: "replacement-user" },
    repos: [
      {
        owner: OWNER,
        repo: REPO,
        token: "ghp_replacement_e2e",
        user: { login: "replacement-user" },
      },
    ],
  });
  expect(errors).toEqual([]);
});
