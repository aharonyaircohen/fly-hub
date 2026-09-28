import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";

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

function apiHeaders(owner: string, repo: string) {
  return {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
}

function defaultChatEntryKey(owner: string, repo: string) {
  return `kody-default-chat-entry:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

async function installAuth(
  page: Page,
  owner: string,
  repo: string,
  extra: Record<string, unknown> = {},
) {
  const user = await resolveLiveGitHubUser(
    page,
    BASE_URL,
    apiHeaders(owner, repo),
  );
  await page.context().addInitScript(
    ({ auth, storage }) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, String(value));
      }
    },
    {
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user,
        loggedInAt: Date.now(),
        ...extra,
      },
      storage: {},
    },
  );
}

async function configuredModel(page: Page, owner: string, repo: string) {
  const headers = apiHeaders(owner, repo);
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
  const names = new Set((secrets.secrets ?? []).map(({ name }) => name));
  const model = (models.models ?? []).find(
    (candidate) =>
      candidate.enabled !== false && names.has(candidate.apiKeySecret),
  );
  expect(model, "an enabled model must have a vault secret").toBeTruthy();
  return model!;
}

async function startNewClientConversation(page: Page) {
  const chat = page.locator('[aria-label="Kody chat"]').first();
  await chat.getByRole("button", { name: "Toggle conversations" }).click();
  const sidebar = page.locator('[data-testid="session-sidebar"]');
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole("button", { name: "New conversation" }).click();
  await sidebar
    .getByRole("button", { name: "Close conversations" })
    .click({ timeout: 10_000 });
  await expect(sidebar).toBeHidden();
  await expect(chat.locator("textarea")).toBeEditable({ timeout: 30_000 });
}

test.describe("Master live user journeys", () => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires explicit live target and repository credentials",
  );

  test("connects a real repository and restores the authenticated selection", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    page.setDefaultTimeout(30_000);
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "domcontentloaded" });
    await page.getByTitle("Switch repository", { exact: true }).click();
    const addButton = page.getByRole("button", {
      name: "Add repository",
      exact: true,
    });
    if (await addButton.isVisible()) await addButton.click();
    await page.getByLabel(/^repository$/i).fill(TEST_REPO);
    await page.getByLabel(/personal access token/i).fill(TEST_TOKEN);
    const validated = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/kody/repos/add") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: /^(connect|add) repository$/i })
      .click();
    expect((await validated).status()).toBe(200);
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${BASE_URL}/api/kody/account/repositories`,
        );
        if (!response.ok()) return false;
        const body = await response.json();
        return (
          body.auth?.repos?.some(
            (entry: { owner: string; repo: string }) =>
              entry.owner === owner && entry.repo === repo,
          ) ?? false
        );
      })
      .toBe(true);
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/chat`, {
      waitUntil: "domcontentloaded",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: repo })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("fully loads the extracted admin pages", async ({ page }) => {
    const { owner, repo } = parseRepo(TEST_REPO);
    await installAuth(page, owner, repo);

    const journeys = [
      {
        url: `${BASE_URL}/repo/${owner}/${repo}/commands`,
        title: "Commands",
        loadedText: "/analyze",
        loadingText: "Loading commands…",
      },
      {
        url: `${BASE_URL}/repo/${owner}/${repo}/guided-flows`,
        title: "Guided Flow Management",
        loadedButton: "Add Guided Flow",
      },
      {
        url: `${BASE_URL}/repo/${owner}/${repo}/context`,
        title: "Context",
        loadedButton: "New entry",
      },
      {
        url: `${BASE_URL}/repo/${owner}/${repo}/brands`,
        title: "Brands",
        loadedButton: "New brand",
      },
      {
        url: `${BASE_URL}/views/widgets`,
        title: "Widgets",
        loadedButton: "Upload widget",
      },
    ] as const;

    for (const journey of journeys) {
      await page.goto(journey.url, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: journey.title, exact: true }),
      ).toBeVisible({
        timeout: 30_000,
      });
      const loadedSignal =
        "loadedButton" in journey
          ? page.getByRole("button", {
              name: journey.loadedButton,
              exact: true,
            })
          : page.getByText(journey.loadedText, { exact: false }).first();
      await expect(loadedSignal).toBeVisible({ timeout: 30_000 });
      if ("loadingText" in journey) {
        await expect(page.getByText(journey.loadingText)).toBeHidden();
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(loadedSignal).toBeVisible({ timeout: 30_000 });
    }
  });

  test("loads Memory as a master-detail page", async ({ page }) => {
    const { owner, repo } = parseRepo(TEST_REPO);
    await installAuth(page, owner, repo);

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/memory`, {
      waitUntil: "domcontentloaded",
    });
    expect(new URL(page.url()).origin).toBe(new URL(BASE_URL).origin);
    await expect(
      page.getByRole("heading", { name: "Memory", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "New memory" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByPlaceholder("Search memory...")).toBeVisible();
  });

  test("saves and restores a real dashboard chat conversation", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    await installAuth(page, owner, repo);

    let conversationId = "";
    let messagePersistStatus = 0;
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
      if (
        response.request().method() === "POST" &&
        response.url().includes("/api/kody/chat/conversations/") &&
        response.url().endsWith("/commands")
      ) {
        messagePersistStatus = response.status();
      }
    });

    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/memory`, {
      waitUntil: "domcontentloaded",
    });
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 30_000 });
    await startNewClientConversation(page);

    const marker = `DASHBOARD_SAVE_E2E_${Date.now()}`;
    await chat.locator("textarea").fill(marker);
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => conversationId, { timeout: 30_000 }).not.toBe("");
    await expect
      .poll(() => messagePersistStatus, { timeout: 30_000 })
      .toBe(200);
    await expect(
      chat.getByRole("alert").filter({
        hasText: "Conversation could not be saved",
      }),
    ).toHaveCount(0);

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(chat.getByText(marker, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        chat.getByRole("alert").filter({
          hasText: "Conversation could not be saved",
        }),
      ).toHaveCount(0);
    } finally {
      if (conversationId) {
        const cleanup = await page.request.delete(
          `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
          { headers: apiHeaders(owner, repo) },
        );
        expect(cleanup.ok()).toBe(true);
      }
    }
  });

  test("uses the real branded client chat and restores its reply", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    const model = await configuredModel(page, owner, repo);
    await installAuth(page, owner, repo);
    await page
      .context()
      .addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: defaultChatEntryKey(owner, repo),
        value: `kody:${model.id}`,
      });

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

    await page.goto(`${BASE_URL}/client/acme`, {
      waitUntil: "domcontentloaded",
    });
    const surface = page.locator('[data-testid="client-chat-surface"]');
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(surface).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="client-brand-name"]')).toHaveText(
      "Acme",
    );
    await expect(page.locator('[aria-label="Kody chat"]')).toHaveCount(1);
    await startNewClientConversation(page);

    const marker = `CLIENT_E2E_${Date.now()}`;
    await chat
      .locator("textarea")
      .fill(`Reply with exactly ${marker} and no other text.`);
    const chatResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    expect((await chatResponse).status()).toBe(200);
    await expect(chat.getByText(marker, { exact: false }).last()).toBeVisible({
      timeout: 240_000,
    });
    await expect.poll(() => conversationId, { timeout: 30_000 }).not.toBe("");
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
            { headers: apiHeaders(owner, repo) },
          );
          if (!response.ok()) return false;
          const body = (await response.json()) as {
            entries?: Array<{
              entry?: { role?: string; content?: string };
            }>;
          };
          return Boolean(
            body.entries?.some(
              ({ entry }) =>
                entry?.role === "assistant" && entry.content?.includes(marker),
            ),
          );
        },
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe(true);

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(chat.getByText(marker, { exact: false }).last()).toBeVisible(
        {
          timeout: 30_000,
        },
      );
    } finally {
      if (conversationId) {
        const cleanup = await page.request.delete(
          `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
          { headers: apiHeaders(owner, repo) },
        );
        expect(cleanup.ok()).toBe(true);
      }
    }
  });

  test("saves and renders a real brand appearance", async ({ page }) => {
    test.setTimeout(180_000);
    const { owner, repo } = parseRepo(TEST_REPO);
    const user = await resolveLiveGitHubUser(
      page,
      BASE_URL,
      apiHeaders(owner, repo),
    );
    await installAuth(page, owner, repo);
    const slug = `theme-e2e-${Date.now()}`;
    const headers = {
      ...apiHeaders(owner, repo),
      "Content-Type": "application/json",
    };
    let created = false;

    try {
      const create = await page.request.post(`${BASE_URL}/api/kody/brands`, {
        headers,
        data: {
          slug,
          name: "Theme E2E",
          accent: "#7c3aed",
          locale: "en",
          appearance: {
            colorScheme: "light",
            background: "#fffaf5",
            surface: "#ffffff",
            foreground: "#292524",
            mutedForeground: "#57534e",
            secondary: "#ede9fe",
            border: "#d6d3d1",
            userMessage: "#6d28d9",
            assistantMessage: "#f5f5f4",
            input: "#ffffff",
            fontSize: "large",
            radius: "rounded",
          },
          access: { mode: "public" },
          actorLogin: user.login,
        },
      });
      expect(create.ok()).toBe(true);
      created = true;

      await page.goto(`${BASE_URL}/client/${owner}/${repo}/${slug}`, {
        waitUntil: "domcontentloaded",
      });
      const surface = page.locator('[data-testid="client-chat-surface"]');
      await expect(surface).toBeVisible({ timeout: 30_000 });
      await expect(surface).toHaveAttribute("data-theme", "light");
      await expect
        .poll(() =>
          surface.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              background: style.backgroundColor,
              foreground: style.color,
              primary: style.getPropertyValue("--primary").trim(),
              surface: style.getPropertyValue("--card").trim(),
              secondary: style.getPropertyValue("--secondary").trim(),
              userMessage: style.getPropertyValue("--chat-user").trim(),
              assistantMessage: style
                .getPropertyValue("--chat-assistant")
                .trim(),
              input: style.getPropertyValue("--chat-input").trim(),
              messageSize: style
                .getPropertyValue("--chat-message-font-size")
                .trim(),
              radius: style.getPropertyValue("--radius").trim(),
            };
          }),
        )
        .toEqual({
          background: "rgb(255, 250, 245)",
          foreground: "rgb(41, 37, 36)",
          primary: "262 83% 58%",
          surface: "0 0% 100%",
          secondary: "251 91% 95%",
          userMessage: "263 70% 50%",
          assistantMessage: "60 5% 96%",
          input: "0 0% 100%",
          messageSize: "18px",
          radius: "1rem",
        });
    } finally {
      if (created) {
        const cleanup = await page.request.delete(
          `${BASE_URL}/api/kody/brands/${slug}?actorLogin=${encodeURIComponent(user.login)}`,
          { headers },
        );
        expect(cleanup.ok()).toBe(true);
      }
    }
  });

  test("keeps the real client chat usable on mobile", async ({ page }) => {
    const { owner, repo } = parseRepo(TEST_REPO);
    const model = await configuredModel(page, owner, repo);
    await page.setViewportSize({ width: 390, height: 844 });
    await installAuth(page, owner, repo);
    await page
      .context()
      .addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: defaultChatEntryKey(owner, repo),
        value: `kody:${model.id}`,
      });
    await page.goto(`${BASE_URL}/client/acme`, {
      waitUntil: "domcontentloaded",
    });

    const surface = page.locator('[data-testid="client-chat-surface"]');
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(surface).toBeVisible({ timeout: 30_000 });
    await startNewClientConversation(page);
    await chat.getByRole("button", { name: "Toggle conversations" }).click();
    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible();
    await expect(async () => {
      const [surfaceBox, sidebarBox] = await Promise.all([
        surface.boundingBox(),
        sidebar.boundingBox(),
      ]);
      expect(surfaceBox).not.toBeNull();
      expect(sidebarBox).not.toBeNull();
      expect(sidebarBox!.width).toBeLessThan(surfaceBox!.width);
    }).toPass();
    await sidebar.getByRole("button", { name: "Close conversations" }).click();
    await expect(chat.locator("textarea")).toBeEditable();
  });
});
