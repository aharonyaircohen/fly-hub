import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("makes a real Agent live, executes one cycle, and shows its persisted activity", async ({
  page,
}) => {
  test.setTimeout(8 * 60_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires a live repository",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  const slug = `live-e2e-${Date.now()}`;
  const intentSlug = `live-intent-${Date.now()}`;
  const title = `Live E2E ${Date.now()}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  headers["x-kody-user-login"] = user.login;
  const { email: loginUser, password: loginPassword } =
    await loadLiveKodyAccountCredentialsFromDashboard(
      page.request,
      BASE_URL,
      process.env,
    );

  const repositoryAuth = {
    repoUrl: TEST_REPO,
    owner,
    repo,
    token: TEST_TOKEN,
    user,
    loggedInAt: Date.now(),
    repos: [
      {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user,
        addedAt: Date.now(),
        isLogin: true,
      },
    ],
    currentRepoIndex: 0,
  };
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((auth) => {
    localStorage.setItem("kody_auth", JSON.stringify(auth));
  }, repositoryAuth);

  const liveUrl = `${BASE_URL}/api/kody/agents/${slug}/live`;
  let created = false;
  let createdIntent = false;
  try {
    const createIntent = await page.request.post(
      `${BASE_URL}/api/kody/intents`,
      {
        headers,
        data: {
          slug: intentSlug,
          body: "Observe the repository and report the most useful next action without changing files.",
          agent: ["*"],
          actorLogin: user.login,
        },
      },
    );
    expect(createIntent.status(), await createIntent.text()).toBe(200);
    createdIntent = true;

    const create = await page.request.post(`${BASE_URL}/api/kody/agents`, {
      headers,
      data: {
        slug,
        title,
        body: "# Agent\n\nKeep the test repository healthy.\n\n# Allowed Commands\n\nInspect only.\n\n# Restrictions\n\nDo not change repository files.",
        actorLogin: user.login,
      },
    });
    expect(create.status(), await create.text()).toBe(200);
    created = true;

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/agents/${slug}`, {
      waitUntil: "domcontentloaded",
    });
    if (
      await page.getByRole("heading", { name: "Sign in to Kody" }).isVisible()
    ) {
      await page.getByLabel("Email").fill(loginUser);
      await page.getByLabel("Password").fill(loginPassword);
      const signInResponse = page.waitForResponse((response) =>
        response.url().includes("/api/auth/sign-in/email"),
      );
      await page.getByRole("button", { name: "Sign in" }).click();
      expect((await signInResponse).status(), "Kody email sign-in failed").toBe(
        200,
      );
      await page.waitForURL(`${BASE_URL}/chat`);
      await expect
        .poll(async () => {
          const session = await page.request.get(
            `${BASE_URL}/api/auth/get-session`,
          );
          if (!session.ok()) return false;
          const body = (await session.json()) as { user?: { id?: string } };
          return Boolean(body.user?.id);
        })
        .toBe(true);
      await page.goto(`${BASE_URL}/repo/${owner}/${repo}/agents/${slug}`, {
        waitUntil: "domcontentloaded",
      });
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const response = await fetch("/api/auth/get-session");
            if (!response.ok) return false;
            const body = (await response.json()) as {
              user?: { id?: string };
            };
            return Boolean(body.user?.id);
          }),
        )
        .toBe(true);
    }
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not live" })).toBeVisible();

    await page.getByRole("button", { name: "Start live Agent" }).click();
    const dialog = page.getByRole("dialog", { name: `Make ${title} live` });
    await dialog.getByLabel("Primary Intent").click();
    await page.getByRole("option", { name: intentSlug }).click();
    await dialog.getByRole("button", { name: "Make live" }).click();

    await expect(page.getByRole("heading", { name: "Live" })).toBeVisible();
    await expect(page.getByText("No activity yet")).toBeVisible();

    const beforeResponse = await page.request.get(liveUrl, { headers });
    expect(beforeResponse.status()).toBe(200);
    const before = (await beforeResponse.json()) as {
      status: { state: { revision: number } | null };
    };
    const beforeRevision = before.status.state?.revision ?? -1;

    const run = await page.request.post(liveUrl, {
      headers,
      data: { action: "run" },
    });
    expect(run.status(), await run.text()).toBe(202);

    await expect
      .poll(
        async () => {
          const response = await page.request.get(liveUrl, { headers });
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            status?: { state?: { revision?: number; summary?: string } | null };
          };
          const state = body.status?.state;
          return state &&
            typeof state.revision === "number" &&
            state.revision > beforeRevision &&
            Boolean(state.summary?.trim())
            ? state
            : null;
        },
        { timeout: 6 * 60_000, intervals: [5_000, 10_000, 15_000] },
      )
      .not.toBeNull();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Live" })).toBeVisible();
    await expect(page.getByText("No activity yet")).toHaveCount(0);

    await page.getByRole("button", { name: "Pause live Agent" }).click();
    await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
    await page.getByRole("button", { name: "Resume live Agent" }).click();
    await expect(page.getByRole("heading", { name: "Live" })).toBeVisible();
  } finally {
    if (created) {
      await page.request.delete(liveUrl, { headers }).catch(() => null);
      await page.request
        .delete(
          `${BASE_URL}/api/kody/agents/${slug}?actorLogin=${encodeURIComponent(user.login)}`,
          { headers },
        )
        .catch(() => null);
    }
    if (createdIntent) {
      await page.request
        .delete(
          `${BASE_URL}/api/kody/intents/${intentSlug}?actorLogin=${encodeURIComponent(user.login)}`,
          { headers },
        )
        .catch(() => null);
    }
  }
});
