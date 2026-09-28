import {
  expect,
  resolveLiveGitHubUser,
  test,
} from "./live-test";
import { openChatSetupSection } from "./support/chat-setup";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const REPOSITORY = process.env.E2E_GITHUB_REPO ?? "";

function repositoryParts() {
  const path = REPOSITORY.includes("://")
    ? new URL(REPOSITORY).pathname
    : REPOSITORY;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("real Kody creates, updates, and protects self-configuration", async ({
  page,
}) => {
  test.setTimeout(900_000);
  test.skip(
    !BASE_URL || !TOKEN || !REPOSITORY,
    "Requires the live target, QA account, and tester repository",
  );

  const { owner, repo } = repositoryParts();
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  });
  const accountResponse = await page.request.get(
    `${BASE_URL}/api/kody/account/repositories`,
  );
  expect(accountResponse.status()).toBe(200);
  const account = (await accountResponse.json()) as {
    auth?: Record<string, unknown> & {
      repos?: Array<
        Record<string, unknown> & { owner?: string; repo?: string }
      >;
    };
  };
  const now = Date.now();
  const originalAuth = account.auth ?? null;
  const repos = [
    ...(originalAuth?.repos ?? []).filter(
      (entry) => entry.owner !== owner || entry.repo !== repo,
    ),
    {
      repoUrl: REPOSITORY,
      owner,
      repo,
      token: TOKEN,
      addedAt: now,
      isLogin: false,
      user,
    },
  ];
  const activeAuth = {
    ...(originalAuth ?? {}),
    repoUrl: REPOSITORY,
    owner,
    repo,
    token: TOKEN,
    user,
    loggedInAt: now,
    repos,
    currentRepoIndex: repos.length - 1,
  };
  expect(
    (
      await page.request.put(`${BASE_URL}/api/kody/account/repositories`, {
        data: { auth: activeAuth },
      })
    ).status(),
  ).toBe(200);

  const headers = {
    "x-kody-token": TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const suffix = Date.now().toString(36);
  const capabilityId = `self-config-proof-${suffix}`;
  const workflowId = `self-config-proof-${suffix}`;
  const missingCapability = `missing-${suffix}`;

  await page.goto(`${BASE_URL}/repo/${owner}/${repo}/chat`, {
    waitUntil: "domcontentloaded",
  });
  const chat = page.locator('[aria-label="Kody chat"]');
  await expect(
    chat.getByRole("button", { name: "New conversation" }),
  ).toBeEnabled({ timeout: 30_000 });
  await chat.getByRole("button", { name: "New conversation" }).click();
  const setup = chat.getByLabel("Chat setup").first();
  await setup.click();
  const models = await openChatSetupSection(chat, "Model");
  await models
    .locator('button[role="option"]')
    .filter({ hasText: "Ox Alpha" })
    .click();

  const send = async (message: string) => {
    const input = chat.locator("textarea").first();
    await expect(input).toBeEnabled({ timeout: 30_000 });
    await input.fill(message);
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    expect((await response).status()).toBe(200);
    await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
      timeout: 300_000,
    });
  };
  const approve = async () => {
    let button = chat.getByRole("button", { name: "Approve" }).last();
    if (!(await button.isVisible())) {
      await send(
        "Approve and apply that exact plan now through the single configuration approval card.",
      );
      button = chat.getByRole("button", { name: "Approve" }).last();
    }
    await expect(button).toBeVisible({ timeout: 300_000 });
    await button.click();
    await expect(button).toBeDisabled({ timeout: 30_000 });
    await expect(chat.getByRole("button", { name: "Stop run" })).toBeHidden({
      timeout: 300_000,
    });
  };

  await send(
    `Configure this repository with capability slug ${capabilityId} and workflow id ${workflowId}. The capability instructions must contain SELF_CONFIG_V1 and return a short health summary. The workflow must call that capability once. Do not add a loop. Run it once and report verified evidence. Use one approval card.`,
  );
  await approve();
  const capabilityUrl = `${BASE_URL}/api/kody/capabilities/${capabilityId}`;
  const workflowUrl = `${BASE_URL}/api/kody/company/workflows/${workflowId}`;
  await expect
    .poll(
      async () => (await page.request.get(capabilityUrl, { headers })).status(),
      { timeout: 60_000 },
    )
    .toBe(200);
  await expect
    .poll(
      async () => (await page.request.get(workflowUrl, { headers })).status(),
      { timeout: 60_000 },
    )
    .toBe(200);

  await send(
    `Update the existing ${capabilityId} and ${workflowId} configuration in place. Replace SELF_CONFIG_V1 with SELF_CONFIG_V2 in the capability instructions. Keep the same IDs, create no duplicates, run once, and use one approval card.`,
  );
  await approve();
  await expect
    .poll(
      async () =>
        JSON.stringify(
          await (await page.request.get(capabilityUrl, { headers })).json(),
        ),
      { timeout: 60_000 },
    )
    .toContain("SELF_CONFIG_V2");

  const beforeInvalid = await (
    await page.request.get(workflowUrl, { headers })
  ).text();
  await send(
    `Try to update workflow ${workflowId} so it references missing capability ${missingCapability}. Do not create that capability. The plan must be rejected before any write, and you must not claim success.`,
  );
  await expect(
    chat.getByText(/missing|reject|cannot|invalid/i).last(),
  ).toBeVisible({ timeout: 300_000 });
  expect(await (await page.request.get(workflowUrl, { headers })).text()).toBe(
    beforeInvalid,
  );
});
