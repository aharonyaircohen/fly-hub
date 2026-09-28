import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";
import { KODY_BUILT_IN_CHAT_MODELS } from "../../../../packages/kody-chat-dashboard/src/dashboard/lib/chat/model-catalog";
import {
  AUTOMATIC_MODEL_ID,
  chatModelScopeFromId,
} from "@kody-ade/base/variables/models";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string): { owner: string; repo: string } {
  try {
    const path = value.includes("://") ? new URL(value).pathname : value;
    const [owner = "", repo = ""] = path.replace(/^\//, "").split("/");
    return { owner, repo };
  } catch {
    return { owner: "", repo: "" };
  }
}

async function installAuth(page: Page, owner: string, repo: string) {
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
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
  const repos = [
    ...(originalAuth?.repos ?? []).filter(
      (entry) => entry.owner !== owner || entry.repo !== repo,
    ),
    {
      repoUrl: TEST_REPO,
      owner,
      repo,
      token: TEST_TOKEN,
      addedAt: now,
      isLogin: false,
      user,
    },
  ];
  const activeAuth = {
    ...(originalAuth ?? {}),
    repoUrl: TEST_REPO,
    owner,
    repo,
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
  expect(saveConnection.status()).toBe(200);
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
      loggedInAt: now,
    },
  );
}

test.describe("Direct Kody chat — real model and persistence", () => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires an explicit live target and repository credentials",
  );

  test("sends a real direct-model turn, persists it, and restores it after reload", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    expect(owner).toBeTruthy();
    expect(repo).toBeTruthy();
    await installAuth(page, owner, repo);

    const headers = {
      "x-kody-token": TEST_TOKEN,
      "x-kody-owner": owner,
      "x-kody-repo": repo,
    };
    const [modelsResponse, repositorySecretsResponse, personalSecretsResponse] =
      await Promise.all([
        page.request.get(`${BASE_URL}/api/kody/models`, { headers }),
        page.request.get(`${BASE_URL}/api/kody/secrets`, { headers }),
        page.request.get(`${BASE_URL}/api/kody/secrets`),
      ]);
    expect(modelsResponse.ok()).toBe(true);
    expect(repositorySecretsResponse.ok()).toBe(true);
    expect(personalSecretsResponse.ok()).toBe(true);
    const models = (await modelsResponse.json()) as {
      models?: Array<{
        id: string;
        label: string;
        apiKeySecret: string;
        enabled?: boolean;
      }>;
    };
    const repositorySecrets = (await repositorySecretsResponse.json()) as {
      secrets?: Array<{ name: string }>;
    };
    const personalSecrets = (await personalSecretsResponse.json()) as {
      secrets?: Array<{ name: string }>;
    };
    const configuredRepositorySecrets = new Set(
      (repositorySecrets.secrets ?? []).map((secret) => secret.name),
    );
    const configuredPersonalSecrets = new Set(
      (personalSecrets.secrets ?? []).map((secret) => secret.name),
    );
    const candidates = [...(models.models ?? []), ...KODY_BUILT_IN_CHAT_MODELS];
    const requestedModelId = process.env.E2E_CHAT_MODEL_ID;
    const configuredModel =
      requestedModelId === AUTOMATIC_MODEL_ID
        ? {
            id: AUTOMATIC_MODEL_ID,
            label: "Automatic",
            apiKeySecret: "",
            enabled: true,
          }
        : candidates.find(
            (model) =>
              model.enabled !== false &&
              (!requestedModelId || model.id === requestedModelId) &&
              (configuredRepositorySecrets.has(model.apiKeySecret) ||
                (chatModelScopeFromId(model.id) !== "repo" &&
                  configuredPersonalSecrets.has(model.apiKeySecret))),
          );
    expect(
      configuredModel,
      `an enabled model must have a vault secret (models: ${(models.models ?? []).map((model) => `${model.id}:${model.apiKeySecret}`).join(", ") || "none"}; repository secrets: ${[...configuredRepositorySecrets].join(", ") || "none"}; personal secrets: ${[...configuredPersonalSecrets].join(", ") || "none"})`,
    ).toBeTruthy();

    let conversationId = "";
    page.on("response", async (response) => {
      if (
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/conversations") &&
        response.status() === 201
      ) {
        const body = (await response.json().catch(() => ({}))) as {
          conversationId?: string;
        };
        conversationId = body.conversationId ?? conversationId;
      }
    });

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]');
    const stop = chat.getByRole("button", { name: "Stop run" });
    if (await stop.isVisible()) await stop.click();
    const newConversation = chat.getByRole("button", {
      name: "New conversation",
    });
    await expect(newConversation).toBeEnabled({ timeout: 15_000 });
    await newConversation.click();

    const chatSetup = chat.getByRole("button", { name: "Chat setup" });
    await chatSetup.click();
    const modelPicker = chat.getByRole("button", { name: "Model" });
    await modelPicker.click();
    await chat
      .locator('[role="listbox"]:visible')
      .first()
      .locator('button[role="option"]')
      .filter({ hasText: configuredModel!.label })
      .first()
      .click();
    await expect(chatSetup).toContainText(configuredModel!.label);

    const marker = `DIRECT_E2E_${Date.now()}`;
    const input = chat.locator("textarea").first();
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill(`Reply with exactly ${marker} and no other text.`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    const response = await responsePromise;
    expect(response.status(), "real direct chat route must succeed").toBe(200);
    await expect(stop).toBeHidden({ timeout: 240_000 });
    await expect(
      chat.getByText(/^\[Error\]/, { exact: false }),
      "the assistant must complete the real model turn instead of surfacing a provider error",
    ).toHaveCount(0);
    await expect
      .poll(() => conversationId, { timeout: 30_000 })
      .not.toHaveLength(0);

    try {
      await expect
        .poll(
          async () => {
            const persistedResponse = await page.request.get(
              `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
              { headers },
            );
            if (!persistedResponse.ok())
              return { status: persistedResponse.status() };
            const persisted = (await persistedResponse.json()) as {
              conversation?: { runtime?: { kind?: string; modelId?: string } };
              entries?: Array<{
                entry?: {
                  kind?: string;
                  role?: string;
                  content?: string;
                  status?: string;
                };
              }>;
            };
            return {
              status: persistedResponse.status(),
              runtime: persisted.conversation?.runtime,
              assistantPersisted: persisted.entries?.some(
                ({ entry }) =>
                  entry?.kind === "message" &&
                  entry.role === "assistant" &&
                  entry.status === "committed" &&
                  entry.content?.includes(marker),
              ),
              assistantPending: persisted.entries?.some(
                ({ entry }) =>
                  entry?.kind === "message" &&
                  entry.role === "assistant" &&
                  entry.status === "pending",
              ),
            };
          },
          { timeout: 30_000, intervals: [250, 500, 1000] },
        )
        .toMatchObject({
          status: 200,
          runtime: {
            kind: "direct",
            modelId: `kody:${configuredModel!.id}`,
          },
          assistantPersisted: true,
          assistantPending: false,
        });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page
          .locator('[aria-label="Kody chat"]')
          .getByText(marker, { exact: false })
          .last(),
      ).toBeVisible({ timeout: 30_000 });

      await page.goto(`${BASE_URL}/repo/${owner}/${repo}/connections`, {
        waitUntil: "domcontentloaded",
      });
      const browserGuidanceChat = page.locator('[aria-label="Kody chat"]');
      const browserGuidanceInput = browserGuidanceChat
        .locator("textarea")
        .first();
      await expect(browserGuidanceInput).toBeEnabled({ timeout: 15_000 });
      const seenAssistantReplies = new Set([marker]);
      for (const request of [
        "i want to post text to fb, guide me how",
        "i want to use browser to post",
      ]) {
        await browserGuidanceInput.fill(request);
        const browserGuidanceResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/kody/chat/kody"),
        );
        await browserGuidanceChat
          .getByRole("button", { name: "Send message" })
          .click();
        expect((await browserGuidanceResponse).status()).toBe(200);
        await expect(stop).toBeHidden({ timeout: 240_000 });
        await expect(page).toHaveURL(
          `${BASE_URL}/repo/${owner}/${repo}/connections`,
        );

        let browserGuidance = "";
        await expect
          .poll(
            async () => {
              const persistedResponse = await page.request.get(
                `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
                { headers },
              );
              if (!persistedResponse.ok()) return "";
              const persisted = (await persistedResponse.json()) as {
                entries?: Array<{
                  entry?: {
                    kind?: string;
                    role?: string;
                    content?: string;
                    status?: string;
                  };
                }>;
              };
              browserGuidance =
                [...(persisted.entries ?? [])]
                  .reverse()
                  .find(
                    ({ entry }) =>
                      entry?.kind === "message" &&
                      entry.role === "assistant" &&
                      entry.status === "committed" &&
                      entry.content &&
                      ![...seenAssistantReplies].some((seen) =>
                        entry.content!.includes(seen),
                      ),
                  )?.entry?.content ?? "";
              return browserGuidance;
            },
            { timeout: 30_000, intervals: [250, 500, 1000] },
          )
          .toMatch(/views|browser/i);
        seenAssistantReplies.add(browserGuidance);
        expect(browserGuidance).not.toMatch(/click\s+connect/i);
        expect(browserGuidance).not.toMatch(
          /\b(?:there\s+is\s+(?:a\s+)?|(?:pick|choose|select|use|offers?|provides?|supports?|includes?)\s+(?:the|a)\s+)browser[- ]based\s+(?:connection|option)\b/i,
        );
        expect(browserGuidance).not.toMatch(
          /publish(?:es|ed|ing)?\s+.*on your behalf/i,
        );
      }
    } finally {
      if (conversationId) {
        const cleanup = await page.request.delete(
          `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
          { headers },
        );
        expect(
          cleanup.ok(),
          `live conversation cleanup must succeed (HTTP ${cleanup.status()}: ${await cleanup.text()})`,
        ).toBe(true);
      }
    }
  });
});
