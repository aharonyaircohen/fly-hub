/**
 * @fileoverview Repo switcher e2e coverage.
 * @testFramework playwright
 * @domain routing
 */

import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

const repos = [
  {
    repoUrl: "https://github.com/OrgOne/RepoOne",
    owner: "OrgOne",
    repo: "RepoOne",
    token: "ghp_fake_one",
    addedAt: 1,
    isLogin: true,
  },
  {
    repoUrl: "https://github.com/OrgTwo/RepoTwo",
    owner: "OrgTwo",
    repo: "RepoTwo",
    token: "ghp_fake_two",
    addedAt: 2,
    isLogin: false,
  },
];

const user = {
  login: "repo-switch-test",
  avatar_url: "https://github.com/github-mark.png",
  id: 1,
};

function authFor(entries: typeof repos) {
  const current = entries[0];
  if (!current) return null;
  return {
    ...current,
    user,
    loggedInAt: 1,
    repos: entries.map((entry) => ({ ...entry, user })),
    currentRepoIndex: 0,
  };
}

async function mockAccountRepositories(
  page: Page,
  initialAuth: ReturnType<typeof authFor>,
  options: { rejectSaves?: boolean } = {},
) {
  await mockDashboardShellRequests(page);
  await page.unroute("**/api/kody/account/repositories");
  let storedAuth: unknown = initialAuth;
  await page.route("**/api/kody/account/repositories", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth: storedAuth }),
      });
    }
    if (method === "DELETE") {
      storedAuth = null;
      return route.fulfill({ status: 200, body: "{}" });
    }
    if (options.rejectSaves) {
      return route.fulfill({ status: 500, body: '{"error":"save failed"}' });
    }
    storedAuth = (route.request().postDataJSON() as { auth?: unknown }).auth;
    return route.fulfill({ status: 200, body: '{"ok":true}' });
  });
}

async function mockRepositoryValidation(
  page: Page,
  onRequest?: (body: { owner: string; repo: string; token: string }) => void,
) {
  await page.route("**/api/kody/repos/add", async (route) => {
    const body = route.request().postDataJSON() as {
      owner: string;
      repo: string;
      token: string;
    };
    onRequest?.(body);
    return route.fulfill({
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
        user,
        webhook: { ok: true, created: false },
        backgroundAccess: { ok: true, source: "encrypted-pat" },
      }),
    });
  });
}

test("header repo dropdown switches to another attached repo", async ({
  page,
}) => {
  await mockAccountRepositories(page, authFor(repos));
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);
  await page.waitForLoadState("domcontentloaded");

  await expect(page.getByRole("button", { name: "RepoOne" })).toBeVisible();
  await page.getByRole("button", { name: "RepoOne" }).click();

  const nextRepo = page.getByRole("button", { name: "RepoTwo", exact: true });
  await expect(nextRepo).toBeVisible();
  await nextRepo.click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("kody_auth");
        if (!raw) return null;
        const auth = JSON.parse(raw) as {
          owner?: string;
          repo?: string;
          currentRepoIndex?: number;
        };
        return {
          owner: auth.owner,
          repo: auth.repo,
          currentRepoIndex: auth.currentRepoIndex,
        };
      }),
    )
    .toEqual({ owner: "OrgTwo", repo: "RepoTwo", currentRepoIndex: 1 });
  await expect(page).toHaveURL(/\/repo\/OrgTwo\/RepoTwo\/tasks$/);
  await expect(page.getByRole("button", { name: "RepoTwo" })).toBeVisible();
});

test("sidebar separates personal and repository navigation", async ({
  page,
}) => {
  await mockAccountRepositories(page, authFor(repos));
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);

  await expect(page.getByText("Account", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Personal" })).toBeVisible();
  await expect(page.getByText("Repository", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Personal" }).click();
  await expect(
    page.getByRole("link", { name: "Chat", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Memory" })).toBeVisible();
});

test("removing the final repository keeps the account and opens personal chat", async ({
  page,
}) => {
  await mockAccountRepositories(page, authFor([repos[0]!]));
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);

  await page
    .getByRole("button", { name: /Switch repository: RepoOne|RepoOne/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Remove OrgOne/RepoOne" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kody_auth")))
    .toBeNull();
  await expect(page.getByText("Your private Chat")).toBeVisible();
});

test("removing one repository keeps the user's other repository", async ({
  page,
}) => {
  await mockAccountRepositories(page, authFor(repos));
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);

  await page.getByRole("button", { name: "RepoOne" }).click();
  await page.getByRole("button", { name: "Remove OrgOne/RepoOne" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();

  await expect(page).toHaveURL(/\/repo\/OrgTwo\/RepoTwo$/);
  await expect(
    page.getByRole("button", { name: "RepoTwo", exact: true }),
  ).toBeVisible();
});

test("signed-in user without repositories can use personal chat and connect one", async ({
  page,
}) => {
  await mockAccountRepositories(page, null);
  await page.goto(`${BASE_URL}/chat`);

  await expect(page.getByText("Your private Chat")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await page.getByRole("button", { name: "Kody Operations" }).click();
  await expect(
    page.getByRole("textbox", { name: "Repository", exact: true }),
  ).toBeVisible();
});

test("signed-in user can override the stored PAT when adding a repository", async ({
  page,
}) => {
  await mockAccountRepositories(page, authFor([repos[0]!]));
  let submittedToken: string | null = null;
  await mockRepositoryValidation(page, (body) => {
    submittedToken = body.token;
  });
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);

  await page.getByRole("button", { name: "RepoOne" }).click();
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Repository", exact: true })
    .fill("AnotherOrg/AnotherRepo");
  await page
    .getByLabel("Personal access token (optional)")
    .fill("ghp_override_token");
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();

  await expect.poll(() => submittedToken).toBe("ghp_override_token");
});

test("mobile add repository form shows the optional PAT override", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAccountRepositories(page, authFor([repos[0]!]));
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);

  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("button", { name: /Switch repository: RepoOne|RepoOne/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();

  await expect(
    page.getByLabel("Personal access token (optional)"),
  ).toBeVisible();
});

test("keeps the connect form open when account persistence fails", async ({
  page,
}) => {
  await mockAccountRepositories(page, null, { rejectSaves: true });
  await mockRepositoryValidation(page);
  await page.goto(`${BASE_URL}/chat`);
  await page.getByRole("button", { name: "Kody Operations" }).click();
  await page
    .getByRole("textbox", { name: "Repository", exact: true })
    .fill("acme/unsaved-repo");
  await page.getByLabel("Personal access token").fill("ghp_test_token");
  await page.getByRole("button", { name: "Connect repository" }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByText(
      "Repository was validated but could not be saved. Try again.",
    ),
  ).toBeVisible();
});

test("waits for account persistence before leaving the connect form", async ({
  page,
}) => {
  await mockDashboardShellRequests(page);
  await page.unroute("**/api/kody/account/repositories");
  let storedAuth: unknown = null;
  let saveCompletedAt = 0;

  await page.route("**/api/kody/account/repositories", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth: storedAuth }),
      });
    }
    const body = route.request().postDataJSON() as { auth?: unknown };
    await new Promise((resolve) => setTimeout(resolve, 500));
    storedAuth = body.auth ?? null;
    saveCompletedAt = Date.now();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await mockRepositoryValidation(page);

  await page.goto(`${BASE_URL}/chat`);
  await page.getByRole("button", { name: "Kody Operations" }).click();
  await page
    .getByRole("textbox", { name: "Repository", exact: true })
    .fill("acme/connected-repo");
  await page.getByLabel("Personal access token").fill("ghp_test_token");
  await page.getByRole("button", { name: "Connect repository" }).click();

  await expect(page).toHaveURL(`${BASE_URL}/`);
  expect(saveCompletedAt).toBeGreaterThan(0);
  await page.getByRole("button", { name: "connected-repo" }).click();
  await expect(
    page.getByRole("button", { name: "connected-repo", exact: true }),
  ).toBeVisible();
});

test("rejects a malformed validated repository without replacing account connections", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockAccountRepositories(page, authFor([repos[0]!]));
  await page.route("**/api/kody/repos/add", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        repository: {
          fullName: "incomplete-owner",
          htmlUrl: "https://github.com/incomplete-owner",
        },
        user,
        webhook: { ok: true },
      }),
    }),
  );
  await page.goto(`${BASE_URL}/repo/OrgOne/RepoOne/tasks`);
  await page.getByRole("button", { name: "RepoOne", exact: true }).click();
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Repository", exact: true })
    .fill("acme/new-repo");
  let saves = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/kody/account/repositories") &&
      request.method() !== "GET"
    )
      saves++;
  });
  await page
    .getByRole("button", { name: "Add repository", exact: true })
    .click();
  await expect(
    page.getByText(
      "Repository was validated but could not be saved. Try again.",
    ),
  ).toBeVisible();
  expect(saves).toBe(0);
  expect(errors).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "RepoOne", exact: true }),
  ).toBeVisible();
});
