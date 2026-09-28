import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "ghp_placeholder";
const TEST_REPO =
  process.env.E2E_GITHUB_REPO ?? "https://github.com/test-owner/test-repo";

function repoIdentity(): { owner: string; repo: string } {
  const url = new URL(TEST_REPO);
  const [owner = "test-owner", repo = "test-repo"] = url.pathname
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean);
  return { owner, repo };
}

async function injectAuth(page: Page): Promise<void> {
  const { owner, repo } = repoIdentity();
  await page.evaluate(
    ({ auth, repoKey }) => {
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      localStorage.setItem(
        `kody-default-chat-entry:${repoKey}`,
        "kody:test/model",
      );
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "kody-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      },
      repoKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
    },
  );
}

test("saving a new pending turn before dispatch survives an immediate refresh", async ({
  page,
}) => {
  const { owner, repo } = repoIdentity();
  let conversation: Record<string, unknown> | null = null;
  const entries: Array<{
    entryId: string;
    seq: number;
    entry: Record<string, unknown>;
  }> = [];
  let activeTurn: Record<string, unknown> | null = null;
  let releaseModel!: () => void;
  const modelRelease = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  let modelRequestStarted!: () => void;
  const modelStarted = new Promise<void>((resolve) => {
    modelRequestStarted = resolve;
  });

  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isCollection = pathname.endsWith("/api/kody/chat/conversations");
    if (request.method() === "GET" && isCollection) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversations: conversation ? [conversation] : [],
        }),
      });
      return;
    }
    if (request.method() === "POST" && isCollection) {
      const input = request.postDataJSON() as Record<string, unknown>;
      const now = new Date().toISOString();
      conversation = {
        ...input,
        scope: { kind: "repository", owner, repo },
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/commands")) {
      const command = request.postDataJSON() as Record<string, unknown>;
      if (command.kind === "append-message") {
        entries.push({
          entryId: String(command.entryId),
          seq: entries.length,
          entry: {
            kind: "message",
            role: command.role,
            content: command.content,
            status: command.status,
            turnId: command.turnId,
            createdAt: command.createdAt,
          },
        });
      } else if (command.kind === "update-message") {
        const stored = entries.find(
          (entry) => entry.entryId === command.entryId,
        );
        if (stored) {
          stored.entry.content = command.content;
          stored.entry.status = command.status;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversation,
        entries,
        turns: activeTurn ? [activeTurn] : [],
        checkpoints: [],
        runtimeBindings: [],
        attachments: [],
      }),
    });
  });
  await page.route("**/api/kody/chat/kody", async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    const turnId = String(input.turnId);
    activeTurn = {
      turnId,
      status: "running",
      agent: { slug: "kody", title: "Kody" },
      startedAt: new Date().toISOString(),
      progress: {
        reasoning: "Checking the repository before answering.",
        toolCalls: [
          {
            id: "tool-1",
            name: "read_file",
            arguments: { path: "README.md" },
            description: "Read a repository file",
            status: "success",
          },
        ],
      },
    };
    modelRequestStarted();
    await modelRelease;
    const pending = entries.find(
      (entry) =>
        entry.entry.kind === "message" &&
        entry.entry.role === "assistant" &&
        entry.entry.status === "pending",
    );
    if (pending) {
      pending.entry.content = "Reply completed after the immediate refresh.";
      pending.entry.status = "committed";
    }
    activeTurn = {
      ...activeTurn,
      status: "completed",
      assistantEntryId: `assistant:${turnId}`,
      completedAt: new Date().toISOString(),
    };
    await route
      .fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          'data: {"type":"text-delta","delta":"Reply completed after the immediate refresh."}\n\n' +
          'data: {"type":"finish"}\n\n' +
          "data: [DONE]\n\n",
      })
      .catch(() => undefined);
  });

  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await injectAuth(page);
  await page.goto(
    `${BASE_URL}/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/chat`,
  );

  const chat = page.locator('[aria-label="Kody chat"]');
  const input = chat.locator("textarea").first();
  await expect(input).toBeEditable({ timeout: 15_000 });
  await input.fill("Answer after I refresh");
  await chat.getByRole("button", { name: "Send message" }).click();
  await modelStarted;
  expect(
    entries.some(
      (entry) =>
        entry.entry.role === "assistant" && entry.entry.status === "pending",
    ),
  ).toBe(true);

  await page.reload();
  await expect(chat.getByText("Thinking…", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const reasoningButton = chat.getByRole("button", { name: /Thinking ▶/ });
  await expect(reasoningButton).toBeVisible({ timeout: 10_000 });
  await reasoningButton.click();
  await expect(
    chat.getByText("Checking the repository before answering."),
  ).toBeVisible();
  const toolsButton = chat.getByRole("button", {
    name: /Thinking — 1 tool/,
  });
  await expect(toolsButton).toBeVisible();
  await toolsButton.click();
  await expect(chat.getByRole("button", { name: /Read file/ })).toBeVisible();
  releaseModel();
  await expect(
    chat.getByText("Reply completed after the immediate refresh."),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    chat.getByRole("button", { name: /Thought — 1 tool/ }),
  ).toBeVisible();
  await expect(chat.getByRole("button", { name: /Thought/ })).toHaveCount(2);
  await expect(chat.getByText("Thinking…", { exact: true })).toHaveCount(0);
});

test("a refreshed chat keeps Thinking visible and loads the durable reply", async ({
  page,
}) => {
  const { owner, repo } = repoIdentity();
  const conversationId = "refresh-running-conversation";
  const turnId = "refresh-running-turn";
  const startedAt = "2026-08-11T10:00:00.000Z";
  let detailReads = 0;
  let completeTurn = false;

  const conversation = {
    conversationId,
    scope: { kind: "repository", owner, repo },
    surface: "global",
    title: "Refresh recovery",
    pinned: false,
    activeAgent: { slug: "kody", title: "Kody" },
    runtime: { kind: "direct", modelId: "test/model" },
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  const userEntry = {
    entryId: "user-message",
    seq: 0,
    entry: {
      kind: "message",
      role: "user",
      content: "Finish this after I refresh",
      status: "committed",
      turnId: "user-message",
      createdAt: startedAt,
    },
  };

  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "GET" &&
      pathname.endsWith("/api/kody/chat/conversations")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [conversation] }),
      });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith(conversationId)) {
      detailReads += 1;
      const completed = completeTurn;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversation: {
            ...conversation,
            updatedAt: completed ? "2026-08-11T10:00:05.000Z" : startedAt,
          },
          entries: completed
            ? [
                userEntry,
                {
                  entryId: `assistant:${turnId}`,
                  seq: 1,
                  entry: {
                    kind: "message",
                    role: "assistant",
                    content: "Reply recovered after refresh.",
                    status: "committed",
                    turnId,
                    createdAt: "2026-08-11T10:00:05.000Z",
                  },
                },
              ]
            : [userEntry],
          turns: [
            {
              turnId,
              status: completed ? "completed" : "running",
              agent: { slug: "kody", title: "Kody" },
              startedAt,
              ...(completed
                ? {
                    assistantEntryId: `assistant:${turnId}`,
                    completedAt: "2026-08-11T10:00:05.000Z",
                  }
                : {}),
            },
          ],
          checkpoints: [],
          runtimeBindings: [],
          attachments: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("domcontentloaded");
  await injectAuth(page);
  await page.goto(
    `${BASE_URL}/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/chat`,
  );

  const chat = page.locator('[aria-label="Kody chat"]');
  await expect(chat.getByText("Thinking…", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  completeTurn = true;
  await expect(chat.getByText("Reply recovered after refresh.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(chat.getByText("Thinking…", { exact: true })).toHaveCount(0);
  expect(detailReads).toBeGreaterThanOrEqual(2);
});
