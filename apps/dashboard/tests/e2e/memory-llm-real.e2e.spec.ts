import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string): { owner: string; repo: string } {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

async function installAuth(page: Page, owner: string, repo: string) {
  const headers = {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  await page.context().addInitScript(
    ({ auth }) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user,
        loggedInAt: Date.now(),
      },
    },
  );
  return headers;
}

async function selectRealModel(page: Page) {
  const headers = {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": parseRepo(TEST_REPO).owner,
    "x-kody-repo": parseRepo(TEST_REPO).repo,
  };
  const [modelsResponse, secretsResponse] = await Promise.all([
    page.request.get(`${BASE_URL}/api/kody/models`, { headers }),
    page.request.get(`${BASE_URL}/api/kody/secrets`, { headers }),
  ]);
  expect(modelsResponse.ok()).toBe(true);
  expect(secretsResponse.ok()).toBe(true);
  const models = (await modelsResponse.json()) as {
    models?: Array<{
      id: string;
      label: string;
      apiKeySecret: string;
      enabled?: boolean;
    }>;
  };
  const secrets = (await secretsResponse.json()) as {
    secrets?: Array<{ name: string }>;
  };
  const configuredSecrets = new Set(
    (secrets.secrets ?? []).map((secret) => secret.name),
  );
  const model = (models.models ?? []).find(
    (candidate) =>
      candidate.enabled !== false &&
      configuredSecrets.has(candidate.apiKeySecret),
  );
  expect(
    model,
    "an enabled real model must have a configured secret",
  ).toBeTruthy();

  const chat = page.locator('[aria-label="Kody chat"]');
  const picker = chat.getByRole("button", { name: "Model" }).first();
  await picker.click();
  await chat
    .locator('[role="listbox"]:visible')
    .first()
    .locator('button[role="option"]')
    .filter({ hasText: model!.label })
    .first()
    .click();
  await expect(picker).toContainText(model!.label);
  return model!;
}

async function sendRealModelMessage(page: Page, message: string) {
  const chat = page.locator('[aria-label="Kody chat"]');
  const input = chat.locator("textarea").first();
  const send = chat.getByRole("button", { name: "Send message" });
  const stop = chat.getByRole("button", {
    name: /^Stop (run|generating)$/,
  });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.fill(message);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/kody/chat/kody"),
    { timeout: 60_000 },
  );
  await send.click();
  const response = await responsePromise;
  expect(response.status(), "the real model route must succeed").toBe(200);
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await expect(stop).toHaveCount(0, { timeout: 240_000 });
  await expect(input).toBeEnabled({ timeout: 240_000 });
}

test("real model uses every memory layer across chat journeys", async ({
  page,
}) => {
  test.setTimeout(900_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires a live app, repository credentials, and a configured model",
  );
  const { owner, repo } = parseRepo(TEST_REPO);
  const headers = await installAuth(page, owner, repo);
  const createdIds: string[] = [];
  const run = `${Date.now()}`;
  const phrase = `Marmalade Falcon ${run}`;

  async function listMemories() {
    const response = await page.request.get(`${BASE_URL}/api/kody/memory`, {
      headers,
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as {
      memories: Array<{
        id: string;
        kind: string;
        scope: { kind: string };
        content: { title: string; summary: string; body: string };
      }>;
    };
  }

  async function findCreated(fragment: string) {
    const result = await expect
      .poll(
        async () => {
          const { memories } = await listMemories();
          return (
            memories.find((memory) =>
              `${memory.content.title} ${memory.content.summary} ${memory.content.body}`.includes(
                fragment,
              ),
            ) ?? null
          );
        },
        { timeout: 30_000, intervals: [250, 500, 1_000] },
      )
      .not.toBeNull();
    void result;
    const { memories } = await listMemories();
    const memory = memories.find((candidate) =>
      `${candidate.content.title} ${candidate.content.summary} ${candidate.content.body}`.includes(
        fragment,
      ),
    );
    expect(memory).toBeTruthy();
    expect(
      memories.filter((candidate) =>
        `${candidate.content.title} ${candidate.content.summary} ${candidate.content.body}`.includes(
          fragment,
        ),
      ),
      `one user request must create exactly one memory for ${fragment}`,
    ).toHaveLength(1);
    createdIds.push(memory!.id);
    return memory!;
  }

  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]');
    const newConversation = chat.getByRole("button", {
      name: "New conversation",
    });
    await expect(newConversation).toBeEnabled({ timeout: 30_000 });
    await newConversation.click();
    const model = await selectRealModel(page);

    const cases = [
      {
        marker: `prefmarker${run}`,
        message: `Remember: I prefer the code phrase ${phrase}; marker prefmarker${run}.`,
        kind: "preference",
        scope: "user",
      },
      {
        marker: `factmarker${run}`,
        message: `Remember: my stable office fact is factmarker${run}.`,
        kind: "fact",
        scope: "user",
      },
      {
        marker: `hebrewmarker${run}`,
        message: `תזכור שהצבע האהוב עליי הוא כחול. marker hebrewmarker${run}.`,
        kind: "preference",
        scope: "user",
      },
      {
        marker: `decisionmarker${run}`,
        message: `Remember: for this repo, the approved decision is decisionmarker${run}; we must use typed memory.`,
        kind: "decision",
        scope: "repository",
      },
      {
        marker: `deadlinemarker${run}`,
        message: `Remember: the repo deadline is deadlinemarker${run}, ship memory proof by 2030-01-02.`,
        kind: "reference",
        scope: "repository",
      },
      {
        marker: `linkmarker${run}`,
        message: `Remember: the repo runbook reference is https://example.test/linkmarker${run}.`,
        kind: "reference",
        scope: "repository",
      },
    ] as const;

    let codePhraseMemoryId = "";
    let codePhraseMemoryTitle = "";
    for (const [index, item] of cases.entries()) {
      if (index > 0) {
        await newConversation.click();
        await selectRealModel(page);
      }
      await sendRealModelMessage(page, item.message);
      const memory = await findCreated(item.marker);
      expect(memory.kind).toBe(item.kind);
      expect(memory.scope.kind).toBe(item.scope);
      if (item.marker === cases[0].marker) {
        codePhraseMemoryId = memory.id;
        codePhraseMemoryTitle = memory.content.title;
      }
    }
    expect(codePhraseMemoryId).toBeTruthy();
    expect(codePhraseMemoryTitle).toBeTruthy();

    await newConversation.click();
    await selectRealModel(page);
    await sendRealModelMessage(
      page,
      `What code phrase did I ask you to remember? Include "${phrase}" exactly.`,
    );
    await expect(chat.getByText(phrase, { exact: false }).last()).toBeVisible({
      timeout: 240_000,
    });

    await newConversation.click();
    await selectRealModel(page);
    await sendRealModelMessage(
      page,
      `Use list_memories now. Find memory id ${codePhraseMemoryId} and answer with its title.`,
    );
    await expect(
      chat.getByText(codePhraseMemoryTitle, { exact: false }).last(),
    ).toBeVisible({ timeout: 240_000 });

    const corrected = `Juniper Comet ${run}`;
    await sendRealModelMessage(
      page,
      `Use update_memory now for id ${codePhraseMemoryId}. Keep it a preference, change the summary to "My code phrase is ${corrected}.", change the body to "Use ${corrected} when asked for my code phrase.", and use reason "The user corrected the live-test preference."`,
    );
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${BASE_URL}/api/kody/memory/${encodeURIComponent(codePhraseMemoryId)}`,
            { headers },
          );
          if (!response.ok()) return null;
          const payload = (await response.json()) as {
            memory: { content: { body: string } };
            revisions: unknown[];
          };
          return {
            body: payload.memory.content.body,
            revisions: payload.revisions.length,
          };
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toEqual({
        body: `Use ${corrected} when asked for my code phrase.`,
        revisions: 2,
      });

    await newConversation.click();
    await selectRealModel(page);
    await sendRealModelMessage(
      page,
      `What is my corrected code phrase? Include "${corrected}" exactly.`,
    );
    await expect(
      chat.getByText(corrected, { exact: false }).last(),
    ).toBeVisible({ timeout: 240_000 });

    await sendRealModelMessage(
      page,
      `Use forget now to permanently delete memory id ${codePhraseMemoryId}. The user explicitly asks to forget it.`,
    );
    await expect
      .poll(
        async () =>
          (
            await page.request.get(
              `${BASE_URL}/api/kody/memory/${encodeURIComponent(codePhraseMemoryId)}`,
              { headers },
            )
          ).status(),
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(404);
    createdIds.splice(createdIds.indexOf(codePhraseMemoryId), 1);

    expect(model.id).toBeTruthy();
  } finally {
    const listed = await listMemories().catch(() => ({ memories: [] }));
    const testIds = listed.memories
      .filter((memory) =>
        `${memory.content.title} ${memory.content.summary} ${memory.content.body}`.includes(
          run,
        ),
      )
      .map((memory) => memory.id);
    for (const id of new Set([...createdIds, ...testIds])) {
      const response = await page.request.delete(
        `${BASE_URL}/api/kody/memory/${encodeURIComponent(id)}`,
        { headers },
      );
      expect([200, 404]).toContain(response.status());
    }
    await expect
      .poll(
        async () => {
          const { memories } = await listMemories();
          return memories.some((memory) =>
            `${memory.content.title} ${memory.content.summary} ${memory.content.body}`.includes(
              run,
            ),
          );
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(false);
  }
});
