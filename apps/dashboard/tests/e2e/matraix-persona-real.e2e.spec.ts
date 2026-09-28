import { expect, resolveLiveGitHubUser, test } from "./live-test";
import type { Browser, TestInfo } from "@playwright/test";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const CREDENTIAL_REPO = process.env.E2E_GITHUB_REPO ?? "";
const TARGET_OWNER = process.env.MATRAIX_KODY_OWNER ?? "aharonyaircohen";
const TARGET_REPO = process.env.MATRAIX_KODY_REPO ?? "kody-chat";
const USERS = [
  { personaId: "0042", displayName: "Casey Brooks" },
  { personaId: "0064", displayName: "Sofia Andersson" },
  { personaId: "0076", displayName: "Amina Diallo" },
  { personaId: "0079", displayName: "Ava Martinez" },
] as const;
const USER_COUNT = Math.min(
  USERS.length,
  Math.max(1, Number(process.env.MATRAIX_USER_COUNT ?? USERS.length)),
);
const ACTIVE_USERS = USERS.slice(0, USER_COUNT);
const QUESTION = "What can you do for this repository?";

type GitHubUser = { login: string; avatar_url: string; id: number };
type AccountAuth = {
  repoUrl: string;
  owner: string;
  repo: string;
  token: string;
  user: GitHubUser;
  loggedInAt: number;
  repos: Array<{
    repoUrl: string;
    owner: string;
    repo: string;
    token: string;
    addedAt: number;
    isLogin: boolean;
    user?: GitHubUser;
  }>;
  currentRepoIndex: number;
  [key: string]: unknown;
};

function withTargetRepository(
  current: AccountAuth | null,
  user: GitHubUser,
  now: number,
): AccountAuth {
  const repoUrl = `https://github.com/${TARGET_OWNER}/${TARGET_REPO}`;
  const target = {
    repoUrl,
    owner: TARGET_OWNER,
    repo: TARGET_REPO,
    token: TEST_TOKEN,
    addedAt: now,
    isLogin: current?.repos.length === 0,
    user,
  };
  const repos = [
    ...(current?.repos ?? []).filter(
      (repo) => repo.owner !== TARGET_OWNER || repo.repo !== TARGET_REPO,
    ),
    target,
  ];
  return {
    ...(current ?? {}),
    repoUrl,
    owner: TARGET_OWNER,
    repo: TARGET_REPO,
    token: TEST_TOKEN,
    user,
    loggedInAt: now,
    repos,
    currentRepoIndex: repos.length - 1,
  };
}

async function runUser(
  browser: Browser,
  activeAuth: AccountAuth,
  login: { email: string; password: string },
  user: (typeof USERS)[number],
  testInfo: TestInfo,
  createdConversationIds: Set<string>,
) {
  const context = await browser.newContext();
  try {
    const signInResult = await context.request.post(
      `${BASE_URL}/api/auth/sign-in/email`,
      {
        headers: { Origin: BASE_URL },
        data: {
          email: login.email,
          password: login.password,
          callbackURL: "/chat",
        },
      },
    );
    expect(signInResult.status(), `${user.displayName} Kody sign-in`).toBe(200);
    await context.addInitScript(
      (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
      activeAuth,
    );
    const userPage = await context.newPage();
    userPage.on("response", async (response) => {
      if (
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/conversations") &&
        response.status() === 201
      ) {
        const body = (await response.json().catch(() => ({}))) as {
          conversationId?: string;
        };
        if (body.conversationId)
          createdConversationIds.add(body.conversationId);
      }
    });

    await userPage.goto(`${BASE_URL}/repo/${TARGET_OWNER}/${TARGET_REPO}`, {
      waitUntil: "domcontentloaded",
    });
    const chat = userPage.locator('[aria-label="Kody chat"]');
    const fresh = chat.getByRole("button", { name: "New conversation" });
    await expect(fresh).toBeEnabled({ timeout: 30_000 });
    await fresh.click();

    const input = chat.locator("textarea").first();
    await expect(input).toBeEnabled({ timeout: 30_000 });
    await input.fill(QUESTION);
    const chatResponse = userPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    expect(
      (await chatResponse).status(),
      `${user.displayName} capability answer route`,
    ).toBe(200);

    const assistant = chat.getByTestId("chat-assistant-message").last();
    await expect
      .poll(
        async () => {
          const answer = (await assistant.innerText()).trim();
          return answer && answer !== "Thinking…" ? answer : "";
        },
        { timeout: 300_000 },
      )
      .not.toBe("");
    await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
      timeout: 300_000,
    });
    const answer = (await assistant.innerText()).trim();
    const screenshot = testInfo.outputPath(
      `matraix-${user.personaId}-kody-answer.png`,
    );
    await userPage.screenshot({ path: screenshot, fullPage: true });
    return {
      personaId: user.personaId,
      displayName: user.displayName,
      question: QUESTION,
      answer,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

test("MatrAIx users receive completed repository capability answers in parallel", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !CREDENTIAL_REPO,
    "Requires the deployed target and QA credential sources",
  );

  const login = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );
  const signInResult = await page.request.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    {
      headers: { Origin: BASE_URL },
      data: {
        email: login.email,
        password: login.password,
        callbackURL: "/chat",
      },
    },
  );
  expect(signInResult.status(), "Kody email sign-in").toBe(200);

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${BASE_URL}/api/auth/get-session`,
      );
      if (!response.ok()) return false;
      const body = ((await response.json()) ?? {}) as {
        user?: { id?: string };
      };
      return Boolean(body.user?.id);
    })
    .toBe(true);

  const accountResponse = await page.request.get(
    `${BASE_URL}/api/kody/account/repositories`,
  );
  expect(accountResponse.status(), "read QA repository connections").toBe(200);
  const accountBody = (await accountResponse.json()) as {
    auth?: AccountAuth | null;
  };
  const originalAuth = accountBody.auth ?? null;
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": TARGET_OWNER,
    "x-kody-repo": TARGET_REPO,
  });
  const activeAuth = withTargetRepository(originalAuth, user, Date.now());
  const createdConversationIds = new Set<string>();
  const saveConnection = await page.request.put(
    `${BASE_URL}/api/kody/account/repositories`,
    { data: { auth: activeAuth } },
  );
  expect(
    saveConnection.status(),
    "save temporary QA repository connection",
  ).toBe(200);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${BASE_URL}/api/kody/account/repositories`,
      );
      if (!response.ok()) return "";
      const body = (await response.json()) as { auth?: AccountAuth | null };
      return body.auth?.owner === TARGET_OWNER &&
        body.auth?.repo === TARGET_REPO
        ? `${body.auth.owner}/${body.auth.repo}`
        : "";
    })
    .toBe(`${TARGET_OWNER}/${TARGET_REPO}`);

  try {
    const results = await Promise.all(
      ACTIVE_USERS.map((persona) =>
        runUser(
          browser,
          activeAuth,
          login,
          persona,
          testInfo,
          createdConversationIds,
        ),
      ),
    );
    expect(results).toHaveLength(ACTIVE_USERS.length);
    expect(new Set(results.map((result) => result.personaId)).size).toBe(
      ACTIVE_USERS.length,
    );
    console.log(`MATRAIX_RESULTS=${JSON.stringify(results)}`);
  } finally {
    await Promise.all(
      [...createdConversationIds].map((conversationId) =>
        page.request.delete(
          `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
          {
            headers: {
              "x-kody-token": TEST_TOKEN,
              "x-kody-owner": TARGET_OWNER,
              "x-kody-repo": TARGET_REPO,
            },
          },
        ),
      ),
    );
    const restore = originalAuth
      ? await page.request.put(`${BASE_URL}/api/kody/account/repositories`, {
          data: { auth: originalAuth },
        })
      : await page.request.delete(`${BASE_URL}/api/kody/account/repositories`);
    expect(restore.ok(), "restore QA repository connections").toBe(true);
  }
});
