import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { createUserOctokit } from "@kody-ade/base/github/core";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
const TODO_SLUG = "director-repo-ci";
const REPORT_SLUG = "director-repo-ci";
const RUN_RETRY_MS = 4 * 60_000;

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("Director turns a real CI failure Report into one Todo and closes it on recovery", async ({
  page,
}) => {
  test.setTimeout(40 * 60_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires the dedicated live repository",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  const octokit = createUserOctokit(TEST_TOKEN);
  const repository = await octokit.repos.get({ owner, repo });
  const branch = repository.data.default_branch;
  let statusSha = "";
  const stamp = Date.now();
  const agentSlug = `director-e2e-${stamp}`;
  const intentSlug = `director-health-${stamp}`;
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
  const auth = {
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
  await page.evaluate(
    (value) => localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await page.goto(`${BASE_URL}/chat`, { waitUntil: "domcontentloaded" });
  await expect
    .poll(
      async () => {
        const text = await page.locator("body").innerText();
        return text.includes("Sign in to Kody") || text.includes("Global chat");
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  if (await page.getByText("Sign in to Kody", { exact: true }).isVisible()) {
    await page.getByLabel("Email").fill(loginUser);
    await page.getByLabel("Password").fill(loginPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE_URL}/chat`);
  }

  const liveUrl = `${BASE_URL}/api/kody/agents/${agentSlug}/live`;
  const reportUrl = `${BASE_URL}/api/kody/reports/${REPORT_SLUG}`;
  const todoUrl = `${BASE_URL}/api/kody/todos/${TODO_SLUG}`;
  const baseline = new Date().toISOString();
  let createdAgent = false;
  let createdIntent = false;

  const runCycle = async () => {
    const beforeResponse = await page.request.get(liveUrl, { headers });
    const before = (await beforeResponse.json()) as {
      status: { state: { revision: number } | null };
    };
    const revision = before.status.state?.revision ?? -1;
    const run = await page.request.post(liveUrl, {
      headers,
      data: { action: "run" },
    });
    expect(run.status(), await run.text()).toBe(202);
    let retryAt = Date.now() + RUN_RETRY_MS;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(liveUrl, { headers });
          if (!response.ok()) return -1;
          const body = (await response.json()) as {
            status?: { state?: { revision?: number } | null };
          };
          const currentRevision = body.status?.state?.revision ?? -1;
          if (currentRevision <= revision && Date.now() >= retryAt) {
            await page.request
              .post(liveUrl, { headers, data: { action: "run" } })
              .catch(() => null);
            retryAt = Date.now() + RUN_RETRY_MS;
          }
          return currentRevision;
        },
        { timeout: 12 * 60_000, intervals: [5_000, 10_000, 15_000] },
      )
      .toBeGreaterThan(revision);
  };

  const waitForReport = async (
    status: "healthy" | "unhealthy",
    after: string,
  ) => {
    let retryAt = Date.now() + RUN_RETRY_MS;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(reportUrl, { headers });
          if (response.ok()) {
            const body = (await response.json()) as {
              report?: { body?: string; updatedAt?: string };
            };
            if (
              body.report?.updatedAt &&
              body.report.updatedAt > after &&
              body.report.body?.includes(`Status:** ${status}`)
            ) {
              return body.report.body;
            }
          }
          if (Date.now() >= retryAt) {
            await page.request
              .post(liveUrl, { headers, data: { action: "run" } })
              .catch(() => null);
            retryAt = Date.now() + RUN_RETRY_MS;
          }
          return "";
        },
        { timeout: 12 * 60_000, intervals: [5_000, 10_000, 15_000] },
      )
      .toContain(`Status:** ${status}`);
    const response = await page.request.get(reportUrl, { headers });
    const body = (await response.json()) as {
      report: { updatedAt: string; runId: string };
    };
    return body.report;
  };

  const waitForTodo = async (completed: boolean, reportRunId: string) => {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(todoUrl, { headers });
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            todo?: {
              items?: Array<{
                id: string;
                completed: boolean;
                meta?: { reportRunId?: string };
              }>;
            };
          };
          const items = body.todo?.items ?? [];
          return {
            count: items.length,
            completed: items[0]?.completed,
            reportIsCurrent: (items[0]?.meta?.reportRunId ?? "") >= reportRunId,
          };
        },
        { timeout: 7 * 60_000, intervals: [5_000, 10_000, 15_000] },
      )
      .toEqual({
        count: 1,
        completed,
        reportIsCurrent: true,
      });
  };

  try {
    await page.request
      .delete(`${todoUrl}?actorLogin=${encodeURIComponent(user.login)}`, {
        headers,
      })
      .catch(() => null);
    const intent = await page.request.post(`${BASE_URL}/api/kody/intents`, {
      headers,
      data: {
        slug: intentSlug,
        body: "Keep the repository healthy. Use current Reports to maintain one Todo per recurring problem and close it only after recovery evidence.",
        agent: ["*"],
        actorLogin: user.login,
      },
    });
    expect(intent.status(), await intent.text()).toBe(200);
    createdIntent = true;

    const agent = await page.request.post(`${BASE_URL}/api/kody/agents`, {
      headers,
      data: {
        slug: agentSlug,
        title: "Director E2E",
        capabilities: ["director-ci-monitor"],
        body: `# Director\n\nManage repository health from evidence. Ignore Reports at or before ${baseline}. First read the newest ${REPORT_SLUG} Report after the last handled time. Continuation data has exactly two responsibility fields: lastHandledReportTime and pendingCheck. When an unseen Report arrives, handle it and submit pendingCheck: null; a completed handoff is never still pending. For every Todo decision, call reconcile_todo with slug exactly ${TODO_SLUG} and itemId exactly repo-ci-main. The Todo-list slug and stable item ID are different fields. Every later decision must update that exact item rather than append another item. If the Report is unhealthy, reconcile that item as open; if healthy, reconcile that same item as resolved. When no unseen Report exists and pendingCheck is null, start director-ci-monitor and store its returned run as pendingCheck. When pendingCheck is not null and no unseen Report exists, wait. Perform every required Todo update and Capability start before calling submit_state. Call submit_state last, storing the handled Report time and current pendingCheck value.`,
        actorLogin: user.login,
      },
    });
    expect(agent.status(), await agent.text()).toBe(200);
    createdAgent = true;

    const activation = await page.request.post(liveUrl, {
      headers,
      data: { action: "activate", intent: intentSlug, every: "1h" },
    });
    expect(activation.status(), await activation.text()).toBe(200);

    const activatedCommit = await octokit.repos.getCommit({
      owner,
      repo,
      ref: branch,
    });
    statusSha = activatedCommit.data.sha;
    await octokit.repos.createCommitStatus({
      owner,
      repo,
      sha: statusSha,
      state: "failure",
      context: "director-e2e",
      description: "Controlled Director E2E failure",
    });

    await runCycle();
    const firstFailureReport = await waitForReport("unhealthy", baseline);
    await runCycle();
    await waitForTodo(false, firstFailureReport.runId);

    await runCycle();
    const repeatedFailureReport = await waitForReport(
      "unhealthy",
      firstFailureReport.updatedAt,
    );
    await runCycle();
    await waitForTodo(false, repeatedFailureReport.runId);

    await octokit.repos.createCommitStatus({
      owner,
      repo,
      sha: statusSha,
      state: "success",
      context: "director-e2e",
      description: "Controlled Director E2E recovery",
    });
    await runCycle();
    const recoveryReport = await waitForReport(
      "healthy",
      repeatedFailureReport.updatedAt,
    );
    await runCycle();
    await waitForTodo(true, recoveryReport.runId);

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/reports`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("treeitem", { name: /Repository CI health/ }).click();
    await page
      .getByRole("treeitem", { name: new RegExp(recoveryReport.runId) })
      .click();
    await expect(
      page.getByText("Repository CI health", { exact: true }).first(),
    ).toBeVisible();
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/todos`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Repository CI health/ }).click();
    await expect(
      page.getByText("1/1 items complete", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    if (statusSha) {
      await octokit.repos
        .createCommitStatus({
          owner,
          repo,
          sha: statusSha,
          state: "success",
          context: "director-e2e",
          description: "Director E2E cleanup",
        })
        .catch(() => null);
    }
    await page.request
      .delete(`${todoUrl}?actorLogin=${encodeURIComponent(user.login)}`, {
        headers,
      })
      .catch(() => null);
    if (createdAgent) {
      await page.request.delete(liveUrl, { headers }).catch(() => null);
      await page.request
        .delete(
          `${BASE_URL}/api/kody/agents/${agentSlug}?actorLogin=${encodeURIComponent(user.login)}`,
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
