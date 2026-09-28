import { createUserOctokit } from "@kody-ade/base/github/core";

import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const CREDENTIAL_REPO = process.env.E2E_GITHUB_REPO ?? "";
const TARGET_OWNER = process.env.MATRAIX_KODY_OWNER ?? "aharonyaircohen";
const TARGET_REPO = process.env.MATRAIX_KODY_REPO ?? "Kody-Engine-Tester";

test("approved task action creates exactly the task shown by Kody", async ({
  page,
}) => {
  test.setTimeout(420_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !CREDENTIAL_REPO,
    "Requires the real local target and QA credential sources",
  );

  const login = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );
  const signIn = await page.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    headers: { Origin: BASE_URL },
    data: {
      email: login.email,
      password: login.password,
      callbackURL: "/chat",
    },
  });
  expect(signIn.status(), "Kody email sign-in").toBe(200);

  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": TARGET_OWNER,
    "x-kody-repo": TARGET_REPO,
  });
  const accountResponse = await page.request.get(
    `${BASE_URL}/api/kody/account/repositories`,
  );
  expect(accountResponse.status()).toBe(200);
  const accountBody = (await accountResponse.json()) as {
    auth?: Record<string, unknown> & {
      repos?: Array<
        Record<string, unknown> & { owner?: string; repo?: string }
      >;
    };
  };
  const originalAuth = accountBody.auth ?? null;
  const now = Date.now();
  const repoUrl = `https://github.com/${TARGET_OWNER}/${TARGET_REPO}`;
  const repos = [
    ...(originalAuth?.repos ?? []).filter(
      (repo) => repo.owner !== TARGET_OWNER || repo.repo !== TARGET_REPO,
    ),
    {
      repoUrl,
      owner: TARGET_OWNER,
      repo: TARGET_REPO,
      token: TEST_TOKEN,
      addedAt: now,
      isLogin: false,
      user,
    },
  ];
  const activeAuth = {
    ...(originalAuth ?? {}),
    repoUrl,
    owner: TARGET_OWNER,
    repo: TARGET_REPO,
    token: TEST_TOKEN,
    user,
    loggedInAt: now,
    repos,
    currentRepoIndex: repos.length - 1,
  };
  const saveConnection = await page.request.put(
    `${BASE_URL}/api/kody/account/repositories`,
    { data: { auth: activeAuth } },
  );
  expect(saveConnection.status(), "save tester repository connection").toBe(
    200,
  );

  const octokit = createUserOctokit(TEST_TOKEN);
  const title = `Live approval proof ${Date.now()}`;
  let issueNumber: number | null = null;
  try {
    await page.goto(`${BASE_URL}/repo/${TARGET_OWNER}/${TARGET_REPO}`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]');
    const fresh = chat.getByRole("button", { name: "New conversation" });
    await expect(fresh).toBeEnabled({ timeout: 30_000 });
    await fresh.click();
    const input = chat.locator("textarea").first();

    const send = async (message: string) => {
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await input.fill(message);
      const response = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          candidate.url().endsWith("/api/kody/chat/kody"),
      );
      await chat.getByRole("button", { name: "Send message" }).click();
      expect((await response).status(), "real Kody chat turn").toBe(200);
      await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
        timeout: 300_000,
      });
    };

    await send(
      `Research this repository for a chore task titled "${title}". The task should add a short APPROVAL_TESTING.md note explaining that approvals run the saved action. Do not change files.`,
    );
    await send(
      `Use your research and prepare that exact chore task now. Use low priority and do not create anything except through the approval card.`,
    );

    const approve = chat.getByRole("button", { name: "Approve" }).last();
    await expect(approve).toBeVisible({ timeout: 300_000 });
    await approve.click();
    await expect(approve).toBeDisabled({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const issues = await octokit.rest.issues.listForRepo({
            owner: TARGET_OWNER,
            repo: TARGET_REPO,
            state: "all",
            per_page: 100,
          });
          const matches = issues.data.filter(
            (issue) => !issue.pull_request && issue.title === title,
          );
          issueNumber = matches[0]?.number ?? null;
          return matches.length;
        },
        { timeout: 60_000 },
      )
      .toBe(1);
    await expect(
      chat.getByText(new RegExp(`Created task #${issueNumber}`)),
    ).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    if (issueNumber) {
      await octokit.rest.issues.update({
        owner: TARGET_OWNER,
        repo: TARGET_REPO,
        issue_number: issueNumber,
        state: "closed",
        state_reason: "not_planned",
      });
    }
    await page.request.put(`${BASE_URL}/api/kody/account/repositories`, {
      data: { auth: originalAuth },
    });
  }
});
