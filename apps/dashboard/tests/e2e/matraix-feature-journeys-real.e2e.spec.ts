import { createUserOctokit } from "@kody-ade/base/github/core";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";

import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const CREDENTIAL_REPO = process.env.E2E_GITHUB_REPO ?? "";
const OWNER = process.env.MATRAIX_KODY_OWNER ?? "aharonyaircohen";
const REPO = process.env.MATRAIX_KODY_REPO ?? "Kody-Engine-Tester";
const CHAT_MODEL_LABEL = process.env.MATRAIX_CHAT_MODEL_LABEL?.trim() ?? "";
const ONLY_PERSONA = process.env.MATRAIX_ONLY_PERSONA?.trim() ?? "";
const SYNC_MINIMAX_KEY = process.env.MATRAIX_SYNC_MINIMAX_KEY === "1";

type AccountAuth = Record<string, unknown> & {
  repos?: Array<Record<string, unknown> & { owner?: string; repo?: string }>;
};

function headers() {
  return {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": OWNER,
    "x-kody-repo": REPO,
  };
}

function monitor(page: Page, failures: string[]) {
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    if (reason === "net::ERR_ABORTED") return;
    failures.push(
      `requestfailed: ${request.method()} ${new URL(request.url()).pathname} ${reason}`.trim(),
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failures.push(
        `response:${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`,
      );
    }
  });
}

async function openPersona(
  browser: Browser,
  login: { email: string; password: string },
  auth: AccountAuth,
) {
  const context = await browser.newContext();
  const signIn = await context.request.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    {
      headers: { Origin: BASE_URL },
      data: { ...login, callbackURL: "/chat" },
    },
  );
  expect(signIn.status()).toBe(200);
  await context.addInitScript(
    (value) => localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  const page = await context.newPage();
  const failures: string[] = [];
  monitor(page, failures);
  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}`, {
    waitUntil: "domcontentloaded",
  });
  return { context, page, failures };
}

async function freshChat(page: Page) {
  const chat = page.locator('[aria-label="Kody chat"]');
  const fresh = chat.getByRole("button", { name: "New conversation" });
  await expect(fresh).toBeEnabled({ timeout: 30_000 });
  await fresh.click();
  return chat;
}

async function selectChatModel(page: Page) {
  if (!CHAT_MODEL_LABEL) return;
  const chat = page.locator('[aria-label="Kody chat"]');
  await chat.getByRole("button", { name: "Chat setup" }).click();
  const menu = chat.getByTestId("chat-setup-menu");
  await menu.getByRole("button", { name: "Model" }).click();
  const option = menu
    .getByRole("option")
    .filter({ hasText: CHAT_MODEL_LABEL })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(chat.getByTestId("chat-setup-primary")).toContainText(
    CHAT_MODEL_LABEL,
  );
}

async function send(page: Page, message: string) {
  const chat = page.locator('[aria-label="Kody chat"]');
  const assistantMessages = chat.getByTestId("chat-assistant-message");
  const previousAnswer =
    (await assistantMessages.count()) > 0
      ? (await assistantMessages.last().innerText()).trim()
      : "";
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
    timeout: 120_000,
  });
  await expect
    .poll(
      async () => {
        if ((await assistantMessages.count()) === 0) return "";
        const current = (await assistantMessages.last().innerText()).trim();
        return current && current !== "Thinking…" && current !== previousAnswer
          ? current
          : "";
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  const visibleAnswer = (await assistantMessages.last().innerText()).trim();
  expect(
    visibleAnswer,
    "Kody must return a visible assistant response",
  ).not.toBe("");
  expect(
    visibleAnswer,
    "Kody must not return a model or transport error",
  ).not.toMatch(
    /^\[?Error(?:\]|:)|model request failed|failed to (?:generate|respond)|reply could not be completed/i,
  );
  return visibleAnswer;
}

async function approve(page: Page, successText: string) {
  const chat = page.locator('[aria-label="Kody chat"]');
  const approveButton = chat.getByRole("button", { name: /^Approve/ }).last();
  await expect(approveButton).toBeVisible({ timeout: 120_000 });
  await approveButton.click();
  await expect(approveButton).toBeDisabled({ timeout: 30_000 });
  const outcome = chat
    .getByText(successText, { exact: false })
    .or(chat.getByText(/^Action failed:/))
    .last();
  await expect(outcome).toBeVisible({ timeout: 60_000 });
  expect((await outcome.innerText()).trim()).toContain(successText);
}

test("four MatrAIx users complete real Kody feature journeys in parallel", async ({
  browser,
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(12 * 60_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !CREDENTIAL_REPO,
    "Requires the local app, QA login, and tester repository",
  );

  const login = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );
  const signIn = await page.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    headers: { Origin: BASE_URL },
    data: { ...login, callbackURL: "/chat" },
  });
  expect(signIn.status()).toBe(200);
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers());
  if (SYNC_MINIMAX_KEY) {
    const key = process.env.MINIMAX_API_KEY;
    expect(key, "MINIMAX_API_KEY must exist in kody-chat/.env").toBeTruthy();
    const saved = await page.request.post(`${BASE_URL}/api/kody/secrets`, {
      headers: headers(),
      data: { name: "MINIMAX_API_KEY", value: key },
    });
    expect(saved.ok(), "the .env MiniMax key must be saved to Kody Vault").toBe(
      true,
    );
  }
  const accountResponse = await page.request.get(
    `${BASE_URL}/api/kody/account/repositories`,
  );
  expect(accountResponse.ok()).toBe(true);
  const originalAuth = (
    (await accountResponse.json()) as { auth?: AccountAuth }
  ).auth;
  const repoUrl = `https://github.com/${OWNER}/${REPO}`;
  const repos = [
    ...(originalAuth?.repos ?? []).filter(
      (repo) => repo.owner !== OWNER || repo.repo !== REPO,
    ),
    {
      repoUrl,
      owner: OWNER,
      repo: REPO,
      token: TEST_TOKEN,
      user,
      addedAt: Date.now(),
      isLogin: false,
    },
  ];
  const activeAuth: AccountAuth = {
    ...(originalAuth ?? {}),
    repoUrl,
    owner: OWNER,
    repo: REPO,
    token: TEST_TOKEN,
    user,
    loggedInAt: Date.now(),
    repos,
    currentRepoIndex: repos.length - 1,
  };
  expect(
    (
      await page.request.put(`${BASE_URL}/api/kody/account/repositories`, {
        data: { auth: activeAuth },
      })
    ).ok(),
  ).toBe(true);

  const suffix = Date.now();
  const taskTitle = `MatrAIx task ${suffix}`;
  const agentSlug = `matraix-agent-${suffix}`;
  const workflowId = `matraix-workflow-${suffix}`;
  const octokit = createUserOctokit(TEST_TOKEN);
  let issueNumber: number | null = null;
  let agentCreated = false;
  let workflowCreated = false;
  const contexts: BrowserContext[] = [];
  const results: Array<Record<string, unknown>> = [];

  try {
    const outcomes = await Promise.allSettled([
      (async () => {
        if (ONLY_PERSONA && ONLY_PERSONA !== "project-manager") return;
        const persona = await openPersona(browser, login, activeAuth);
        contexts.push(persona.context);
        await freshChat(persona.page);
        await selectChatModel(persona.page);
        await send(
          persona.page,
          `Create exactly one low-priority chore task titled "${taskTitle}" that adds docs/MATRAIX_TASK_PROOF.md. Prepare it through Kody's approval flow, but do not change files or execute the task.`,
        );
        await approve(persona.page, "Created task #");
        await expect
          .poll(
            async () => {
              const response = await octokit.rest.issues.listForRepo({
                owner: OWNER,
                repo: REPO,
                state: "all",
                per_page: 100,
              });
              const matches = response.data.filter(
                (issue) => !issue.pull_request && issue.title === taskTitle,
              );
              issueNumber = matches[0]?.number ?? null;
              return matches.length;
            },
            { timeout: 60_000 },
          )
          .toBe(1);
        await expect(
          persona.page.getByText(new RegExp(`Created task #${issueNumber}`)),
        ).toBeVisible();
        expect(persona.failures).toEqual([]);
        results.push({ persona: "0042", role: "project-manager", issueNumber });
      })(),
      (async () => {
        if (ONLY_PERSONA && ONLY_PERSONA !== "agency-admin") return;
        const persona = await openPersona(browser, login, activeAuth);
        contexts.push(persona.context);
        await freshChat(persona.page);
        await selectChatModel(persona.page);
        await send(
          persona.page,
          `Create exactly one read-only QA Agent named MatrAIx Agent ${suffix} with slug ${agentSlug}. It may inspect the repository but must never change files. Prepare it through Kody's approval flow.`,
        );
        await approve(persona.page, "Agent created.");
        await expect
          .poll(
            async () =>
              (
                await persona.page.request.get(
                  `${BASE_URL}/api/kody/agents/${agentSlug}`,
                  { headers: headers() },
                )
              ).status(),
            { timeout: 60_000 },
          )
          .toBe(200);
        agentCreated = true;
        await expect(persona.page.getByText("Agent created.")).toBeVisible();
        expect(persona.failures).toEqual([]);
        results.push({ persona: "0076", role: "agency-admin", agentSlug });
      })(),
      (async () => {
        if (ONLY_PERSONA && ONLY_PERSONA !== "workflow-designer") return;
        const persona = await openPersona(browser, login, activeAuth);
        contexts.push(persona.context);
        await freshChat(persona.page);
        await selectChatModel(persona.page);
        const capabilityResponse = await persona.page.request.get(
          `${BASE_URL}/api/kody/capabilities`,
          { headers: headers() },
        );
        expect(capabilityResponse.ok()).toBe(true);
        const capabilitySlug = (
          (await capabilityResponse.json()) as {
            capabilities?: Array<{ slug?: string }>;
          }
        ).capabilities?.find((capability) => capability.slug)?.slug;
        expect(
          capabilitySlug,
          "the tester repository must expose an active Capability",
        ).toBeTruthy();
        const workflowRequest = `Create exactly one named Workflow, not an Agency request, named MatrAIx Workflow ${suffix} with id ${workflowId}. Use the existing Capability ${capabilitySlug}, do not run it automatically, and prepare it through Kody's approval flow.`;
        await send(persona.page, workflowRequest);
        const workflowChat = persona.page.locator('[aria-label="Kody chat"]');
        const begin = workflowChat.getByRole("button", { name: "Begin" });
        let recoveredFromAgencyRequest = false;
        if (await begin.isVisible()) {
          recoveredFromAgencyRequest = true;
          await freshChat(persona.page);
          await selectChatModel(persona.page);
          await send(
            persona.page,
            `${workflowRequest} Do not start any Guided Flow. Call the Workflow creation tool directly with the complete name and Capability.`,
          );
        }
        await expect(begin).toBeHidden();
        const workflowForm = workflowChat
          .getByText("What should this workflow run?")
          .locator("..");
        let completedViaGuidedFlow = false;
        if (await workflowForm.isVisible()) {
          await workflowForm
            .getByLabel("Workflow name")
            .fill(`MatrAIx Workflow ${suffix}`);
          await workflowForm
            .getByLabel("Capability slug")
            .fill(capabilitySlug!);
          await workflowForm
            .getByRole("button", { name: "Review workflow" })
            .click();
          const createWorkflow = workflowChat.getByRole("button", {
            name: "Create workflow",
          });
          const nextAction = createWorkflow.or(
            workflowChat.getByRole("button", { name: /^Approve/ }),
          );
          await expect(nextAction).toBeVisible({ timeout: 30_000 });
          if (await createWorkflow.isVisible()) {
            await createWorkflow.click();
            const completion = workflowChat
              .getByText("GuidedFlow completed.", { exact: true })
              .or(workflowChat.getByRole("button", { name: /^Approve/ }));
            await expect(completion).toBeVisible({ timeout: 60_000 });
            completedViaGuidedFlow = await workflowChat
              .getByText("GuidedFlow completed.", { exact: true })
              .isVisible();
          }
        }
        if (!completedViaGuidedFlow) {
          await approve(persona.page, "Workflow saved.");
        }
        await expect
          .poll(
            async () =>
              (
                await persona.page.request.get(
                  `${BASE_URL}/api/kody/company/workflows/${workflowId}`,
                  { headers: headers() },
                )
              ).status(),
            { timeout: 60_000 },
          )
          .toBe(200);
        workflowCreated = true;
        await expect(
          persona.page.getByText(
            completedViaGuidedFlow
              ? "GuidedFlow completed."
              : "Workflow saved.",
          ),
        ).toBeVisible();
        expect(persona.failures).toEqual([]);
        results.push({
          persona: "0079",
          role: "workflow-designer",
          workflowId,
          recoveredFromAgencyRequest,
          completedViaGuidedFlow,
        });
      })(),
      (async () => {
        if (ONLY_PERSONA && ONLY_PERSONA !== "repository-owner") return;
        const persona = await openPersona(browser, login, activeAuth);
        contexts.push(persona.context);
        const pages = [
          ["commands", "Repository Commands"],
          ["memory", "Repository Memory"],
          ["models", "Personal Chat Models"],
          ["guided-flows", "Personal Guided Flows"],
          ["files", "Files"],
        ] as const;
        for (const [path, heading] of pages) {
          const url = ["models", "guided-flows"].includes(path)
            ? `${BASE_URL}/${path}`
            : `${BASE_URL}/repo/${OWNER}/${REPO}/${path}`;
          await persona.page.goto(url, { waitUntil: "domcontentloaded" });
          await expect(
            persona.page.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible({ timeout: 30_000 });
        }
        expect(persona.failures).toEqual([]);
        results.push({
          persona: "0064",
          role: "repository-owner",
          verified: pages.map(([path]) => path),
        });
      })(),
    ]);

    const failures = outcomes.flatMap((outcome, index) =>
      outcome.status === "rejected"
        ? [
            {
              journey: [
                "project-manager",
                "agency-admin",
                "workflow-designer",
                "repository-owner",
              ][index],
              error:
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : String(outcome.reason),
            },
          ]
        : [],
    );
    await testInfo.attach("matraix-feature-results.json", {
      body: Buffer.from(JSON.stringify({ results, failures }, null, 2)),
      contentType: "application/json",
    });
    expect(failures, "every MatrAIx journey must pass").toEqual([]);
    expect(results).toHaveLength(ONLY_PERSONA ? 1 : 4);
  } finally {
    if (issueNumber) {
      await octokit.rest.issues.update({
        owner: OWNER,
        repo: REPO,
        issue_number: issueNumber,
        state: "closed",
        state_reason: "not_planned",
      });
    }
    if (agentCreated) {
      await page.request.delete(
        `${BASE_URL}/api/kody/agents/${agentSlug}?actorLogin=${encodeURIComponent(user.login)}`,
        { headers: headers() },
      );
    }
    if (workflowCreated) {
      await page.request.delete(
        `${BASE_URL}/api/kody/company/workflows/${workflowId}`,
        { headers: headers() },
      );
    }
    await Promise.allSettled(contexts.map((context) => context.close()));
    await page.request.put(`${BASE_URL}/api/kody/account/repositories`, {
      data: { auth: originalAuth ?? null },
    });
  }
});
