/**
 * @fileoverview Live browser verifier for the Brain terminal UI.
 * @testFramework playwright
 * @domain terminal-live
 */
import { expect, resolveLiveGitHubUser, test, type Page } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const TEST_TOKEN =
  process.env.KODY_LIVE_GITHUB_TOKEN ??
  process.env.E2E_GITHUB_TOKEN ??
  process.env.GITHUB_TOKEN ??
  process.env.KODY_BOT_TOKEN ??
  process.env.GH_TOKEN ??
  "";
const REPO_SLUG =
  process.env.KODY_LIVE_REPO_SLUG ??
  process.env.KODY_REPO_SLUG ??
  slugFromUrl(process.env.KODY_LIVE_REPO_URL) ??
  slugFromUrl(process.env.E2E_GITHUB_REPO) ??
  "";
const STORE_REPO_URL = process.env.KODY_LIVE_STORE_REPO_URL;
const STORE_REF = process.env.KODY_LIVE_STORE_REF;
const WAIT_MS = Number(process.env.KODY_LIVE_UI_WAIT_MS ?? 75_000);

test.setTimeout(Math.max(180_000, WAIT_MS + 120_000));

function slugFromUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/github\.com[:/]+([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function parseSlug(slug: string): { owner: string; repo: string } | null {
  const [owner, repo] = slug.split("/");
  return owner && repo ? { owner, repo } : null;
}

async function installAuth(contextPage: Page, owner: string, repo: string) {
  const user = await resolveLiveGitHubUser(contextPage, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  });
  await contextPage.context().addInitScript(
    (auth) => {
      localStorage.clear();
      localStorage.setItem("kody_auth", JSON.stringify(auth));
    },
    {
      repoUrl: `https://github.com/${owner}/${repo}`,
      owner,
      repo,
      token: TEST_TOKEN,
      user,
      loggedInAt: Date.now(),
      ...(STORE_REPO_URL ? { storeRepoUrl: STORE_REPO_URL } : {}),
      ...(STORE_REF ? { storeRef: STORE_REF } : {}),
    },
  );
  return user;
}

function repoHeaders(owner: string, repo: string): Record<string, string> {
  return {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
}

async function setRepoBrainChatEnabled(
  page: Page,
  owner: string,
  repo: string,
  actorLogin: string,
  enabled: boolean,
): Promise<void> {
  const response = await page.request.put(
    `${BASE_URL}/api/kody/dashboard-config`,
    {
      headers: repoHeaders(owner, repo),
      data: { brainFlyChatEnabled: enabled, actorLogin },
    },
  );
  expect(response.ok(), "Repo Brain chat setting must be writable").toBe(true);
}

async function visibleTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      return Boolean(
        html.offsetWidth || html.offsetHeight || html.getClientRects().length,
      );
    };
    return Array.from(document.querySelectorAll(".xterm"))
      .filter(isVisible)
      .map((terminal) =>
        Array.from(terminal.querySelectorAll(".xterm-rows div"))
          .map((row) => row.textContent ?? "")
          .join("\n"),
      )
      .join("\n");
  });
}

async function waitForTerminalText(page: Page, text: string, timeout = 45_000) {
  await expect
    .poll(() => visibleTerminalText(page), { timeout, intervals: [500, 1000] })
    .toContain(text);
}

async function waitForBrainTerminalReady(page: Page) {
  await expect(page.getByLabel("Terminal command input")).toBeEnabled({
    timeout: 120_000,
  });
  await expect
    .poll(() => visibleTerminalText(page), {
      timeout: 120_000,
      intervals: [1000, 2500],
    })
    .toMatch(/\/workspace(?:\/[^#$\s]+)?[#$]/);
}

async function typeCommand(page: Page, command: string) {
  await page.locator(".xterm").last().click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function selectVisibleTerminalText(page: Page, text: string) {
  const rect = await page
    .locator(".xterm")
    .last()
    .evaluate((terminal, value) => {
      const rows = Array.from(terminal.querySelectorAll(".xterm-rows div"));
      const targetRow = rows.find((row) =>
        (row.textContent ?? "").includes(value),
      );
      if (!targetRow) return null;
      const walker = document.createTreeWalker(targetRow, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node as Text);
        node = walker.nextNode();
      }
      const rowText = nodes.map((item) => item.data).join("");
      const startOffset = rowText.indexOf(value);
      if (startOffset < 0) return null;
      const endOffset = startOffset + value.length;
      let consumed = 0;
      let start: { node: Text; offset: number } | null = null;
      let end: { node: Text; offset: number } | null = null;
      for (const textNode of nodes) {
        const nextConsumed = consumed + textNode.data.length;
        if (!start && startOffset >= consumed && startOffset < nextConsumed) {
          start = { node: textNode, offset: startOffset - consumed };
        }
        if (endOffset > consumed && endOffset <= nextConsumed) {
          end = { node: textNode, offset: endOffset - consumed };
          break;
        }
        consumed = nextConsumed;
      }
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const bounds = range.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    }, text);
  expect(rect, `terminal row containing ${text}`).not.toBeNull();
  if (!rect) return;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + Math.max(2, rect.width - 1), y, {
    steps: 12,
  });
  await page.mouse.up();
}

test.describe("Brain terminal live UI", () => {
  test("sends a real Brain chat turn and shows the reply", async ({ page }) => {
    test.setTimeout(420_000);
    const repo = parseSlug(REPO_SLUG);
    expect(TEST_TOKEN, "live GitHub token").toBeTruthy();
    expect(repo, "live repository slug").not.toBeNull();
    const user = await installAuth(page, repo!.owner, repo!.repo);
    const configResponse = await page.request.get(
      `${BASE_URL}/api/kody/dashboard-config`,
      { headers: repoHeaders(repo!.owner, repo!.repo) },
    );
    expect(configResponse.ok()).toBe(true);
    const currentConfig = (await configResponse.json()) as {
      config?: { brainFlyChatEnabled?: boolean };
    };
    const wasEnabled = currentConfig.config?.brainFlyChatEnabled === true;
    await setRepoBrainChatEnabled(
      page,
      repo!.owner,
      repo!.repo,
      user.login,
      true,
    );

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

    try {
      await page.goto(`${BASE_URL}/repo/${repo!.owner}/${repo!.repo}`, {
        waitUntil: "domcontentloaded",
      });
      const chat = page.locator('[aria-label="Kody chat"]');
      const stop = chat.getByRole("button", { name: "Stop run" });
      if (await stop.isVisible()) await stop.click();
      const newConversation = chat.getByRole("button", {
        name: "New conversation",
      });
      await expect(newConversation).toBeEnabled({ timeout: 30_000 });
      await newConversation.click();

      const modelPicker = chat.getByRole("button", { name: "Model" }).first();
      await modelPicker.click();
      const brainOption = chat
        .locator('[role="listbox"]:visible button[role="option"]')
        .filter({ hasText: /^Repo Brain/ })
        .first();
      await expect(brainOption).toBeVisible({ timeout: 30_000 });
      await brainOption.click();
      await expect(modelPicker).toContainText("Repo Brain");

      // Use a provider-neutral numeric marker. Some reasoning models preserve
      // the unique value but omit a descriptive prefix even when asked for an
      // exact reply; the live gate is proving transport and persistence, not
      // instruction-following style.
      const marker = String(Date.now());
      await chat
        .locator("textarea")
        .fill(`Reply with this exact number: ${marker}`);
      const brainResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/kody/chat/brain-fly"),
      );
      await chat.getByRole("button", { name: "Send message" }).click();
      const brainResponse = await brainResponsePromise;
      expect(
        brainResponse.status(),
        "real Repo Brain chat route must succeed",
      ).toBe(200);
      await expect(
        chat
          .locator('[data-role="assistant"]')
          .filter({ hasText: marker })
          .last(),
      ).toBeVisible({ timeout: 300_000 });
      await expect.poll(() => conversationId, { timeout: 30_000 }).not.toBe("");

      if (conversationId) {
        await expect
          .poll(
            async () => {
              const persistedResponse = await page.request.get(
                `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
                { headers: repoHeaders(repo!.owner, repo!.repo) },
              );
              if (!persistedResponse.ok()) return false;
              const persisted = (await persistedResponse.json()) as {
                entries?: Array<{
                  entry?: { kind?: string; role?: string; content?: string };
                }>;
              };
              return Boolean(
                persisted.entries?.some(
                  ({ entry }) =>
                    entry?.kind === "message" &&
                    entry.role === "assistant" &&
                    entry.content?.includes(marker),
                ),
              );
            },
            { timeout: 30_000, intervals: [250, 500, 1000] },
          )
          .toBe(true);
        const cleanup = await page.request.delete(
          `${BASE_URL}/api/kody/chat/conversations/${conversationId}`,
          { headers: repoHeaders(repo!.owner, repo!.repo) },
        );
        expect(cleanup.ok()).toBe(true);
      }
    } finally {
      await setRepoBrainChatEnabled(
        page,
        repo!.owner,
        repo!.repo,
        user.login,
        wasEnabled,
      );
    }
  });

  test("selects Brain, keeps xterm visible, and accepts input after the stall window", async ({
    page,
  }) => {
    const repo = parseSlug(REPO_SLUG);
    if (!TEST_TOKEN || !repo) {
      test.skip(
        true,
        "Set KODY_LIVE_GITHUB_TOKEN and KODY_LIVE_REPO_SLUG=owner/repo",
      );
      return;
    }

    const terminalSessionResponses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/kody/terminal/session")) {
        terminalSessionResponses.push(response.status());
      }
    });

    await installAuth(page, repo.owner, repo.repo);
    await page.goto(`${BASE_URL}/repo/${repo.owner}/${repo.repo}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByLabel("More compose options").click();
    await page
      .getByRole("button", { name: /Terminal/ })
      .first()
      .click();
    const target = page.locator('select[aria-label="Terminal target"]:visible').last();
    await expect(target).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () =>
          target.locator("option").evaluateAll((options) =>
            options.map((option) => ({
              value: (option as HTMLOptionElement).value,
              text: option.textContent ?? "",
            })),
          ),
        { timeout: 60_000, intervals: [1000, 2500] },
      )
      .toContainEqual(expect.objectContaining({ value: "brain" }));

    await target.selectOption("brain");
    await waitForBrainTerminalReady(page);

    expect(terminalSessionResponses).toContain(200);
    await expect.poll(() => visibleTerminalText(page)).not.toHaveLength(0);

    const firstMarker = `KODY_UI_FIRST_${Date.now()}`;
    await typeCommand(page, `printf "${firstMarker}\\n"`);
    await waitForTerminalText(page, firstMarker);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("More compose options").click();
    await page
      .getByRole("button", { name: /Terminal/ })
      .first()
      .click();
    const restoredTarget = page
      .locator('select[aria-label="Terminal target"]:visible')
      .last();
    await expect(restoredTarget).toBeVisible({ timeout: 20_000 });
    await restoredTarget.selectOption("brain");
    await waitForBrainTerminalReady(page);

    const restoredMarker = `KODY_UI_RESTORED_${Date.now()}`;
    await typeCommand(page, `printf "${restoredMarker}\\n"`);
    await waitForTerminalText(page, restoredMarker);

    await selectVisibleTerminalText(page, restoredMarker);
    await expect(
      page.getByRole("button", { name: "Copy selection" }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Copy selection" }).click();

    await page.waitForTimeout(WAIT_MS);
    await waitForBrainTerminalReady(page);
    await expect.poll(() => visibleTerminalText(page)).not.toHaveLength(0);

    const secondMarker = `KODY_UI_SECOND_${Date.now()}`;
    await typeCommand(page, `printf "${secondMarker}\\n"`);
    await waitForTerminalText(page, secondMarker);
  });
});
