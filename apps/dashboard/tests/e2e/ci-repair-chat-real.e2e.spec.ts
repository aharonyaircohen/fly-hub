import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string): { owner: string; repo: string } {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\//, "").split("/");
  return { owner, repo };
}

async function installAuth(page: Page, owner: string, repo: string) {
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  });
  await page.context().addInitScript(
    (auth) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
    },
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      user,
      loggedInAt: Date.now(),
    },
  );
}

test.describe("CI Repair through real Chat and Engine", () => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires the live Dashboard and tester repository",
  );

  test("runs healthy main-branch CI without requiring a PR", async ({ page }) => {
    test.setTimeout(480_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    await installAuth(page, owner, repo);
    const dashboardHeaders = {
      "x-kody-token": TEST_TOKEN,
      "x-kody-owner": owner,
      "x-kody-repo": repo,
    };
    const githubHeaders = {
      authorization: `Bearer ${TEST_TOKEN}`,
      accept: "application/vnd.github+json",
    };

    const ciResponse = await page.request.get(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/test-ci.yml/runs?branch=main&status=success&per_page=1`,
      { headers: githubHeaders },
    );
    expect(ciResponse.ok(), "tester repository must have a successful main CI run").toBe(true);
    const ciBody = (await ciResponse.json()) as {
      workflow_runs?: Array<{ id: number; head_branch: string; head_sha: string }>;
    };
    const ciRun = ciBody.workflow_runs?.[0];
    expect(ciRun, "a successful main CI run is required").toBeTruthy();

    const runStateUrl = `${BASE_URL}/api/kody/company/workflows/ci-repair/runs`;
    const beforeResponse = await page.request.get(runStateUrl, {
      headers: dashboardHeaders,
    });
    expect(beforeResponse.ok()).toBe(true);
    const before = (await beforeResponse.json()) as { run?: { runId?: string } };

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/pipelines/ci-repair`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]');
    const stop = chat.getByRole("button", { name: "Stop run" });
    if (await stop.isVisible()) await stop.click();
    await chat.getByRole("button", { name: "New conversation" }).click();

    const [modelsResponse, secretsResponse] = await Promise.all([
      page.request.get(`${BASE_URL}/api/kody/models`, { headers: dashboardHeaders }),
      page.request.get(`${BASE_URL}/api/kody/secrets`, { headers: dashboardHeaders }),
    ]);
    const models = (await modelsResponse.json()) as {
      models?: Array<{ id: string; label: string; apiKeySecret: string; enabled?: boolean }>;
    };
    const secrets = (await secretsResponse.json()) as { secrets?: Array<{ name: string }> };
    const configuredSecrets = new Set((secrets.secrets ?? []).map((secret) => secret.name));
    const available = (models.models ?? []).filter(
      (model) => model.enabled !== false && configuredSecrets.has(model.apiKeySecret),
    );
    const selected = available.find((model) => /deepseek/i.test(`${model.id} ${model.label}`)) ?? available[0];
    expect(selected, "an enabled direct model with a configured secret is required").toBeTruthy();

    await chat.getByRole("button", { name: "Chat setup" }).click();
    const modelPicker = chat.getByRole("button", { name: "Model" });
    await modelPicker.click();
    await chat
      .locator('[role="listbox"]:visible')
      .first()
      .locator('button[role="option"]')
      .filter({ hasText: selected!.label })
      .first()
      .click();

    const input = chat.locator("textarea").first();
    await input.fill(
      `Run the active CI Repair workflow now for branch ${ciRun!.head_branch}, ciRunId ${ciRun!.id}, and headSha ${ciRun!.head_sha}. There is no PR. Use the workflow tools and do not ask me for a PR number.`,
    );
    const chatResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    expect((await chatResponse).status()).toBe(200);

    await expect
      .poll(
        async () => {
          const response = await page.request.get(runStateUrl, {
            headers: dashboardHeaders,
          });
          if (!response.ok()) return null;
          const body = (await response.json()) as {
            run?: {
              runId?: string;
              state?: { status?: string; completedStepIds?: string[] };
            };
          };
          if (!body.run || body.run.runId === before.run?.runId) return null;
          return body.run;
        },
        { timeout: 420_000, intervals: [5_000] },
      )
      .toMatchObject({
        state: {
          status: "done",
          completedStepIds: expect.arrayContaining(["check", "finalize"]),
        },
      });
  });
});
