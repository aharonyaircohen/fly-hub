import { expect, resolveLiveGitHubUser, test } from "./live-test";
import { loadLiveKodyAccountCredentialsFromDashboard } from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";

function parseRepo(value: string): { owner: string; repo: string } {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("personal secret enables real Chat", async ({ page }) => {
  test.setTimeout(360_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO || !OPENROUTER_KEY,
    "Requires the configured live target, QA login source, and OpenRouter key",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  });
  const { email, password } = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  const signInHeading = page.getByRole("heading", { name: "Sign in to Kody" });
  const chatSurface = page.locator('[aria-label="Kody chat"]');
  await expect
    .poll(
      async () =>
        (await signInHeading.isVisible()) || (await chatSurface.isVisible()),
      {
        timeout: 30_000,
      },
    )
    .toBe(true);
  if (await signInHeading.isVisible()) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    const signInResponse = page.waitForResponse((response) =>
      response.url().includes("/api/auth/sign-in/email"),
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await signInResponse).status(), "Kody email sign-in failed").toBe(
      200,
    );
    await page.waitForURL(/\/chat$/);
  }

  await expect
    .poll(async () => {
      const session = await page.request.get(
        `${BASE_URL}/api/auth/get-session`,
      );
      if (!session.ok()) return false;
      const body = ((await session.json()) ?? {}) as { user?: { id?: string } };
      return Boolean(body.user?.id);
    })
    .toBe(true);

  const secretName = "OPENROUTER_API_KEY";
  const before = await page.request.get(`${BASE_URL}/api/kody/secrets`);
  const beforeText = await before.text();
  expect(before.ok(), `${before.status()} ${beforeText.slice(0, 300)}`).toBe(
    true,
  );
  const beforeBody = JSON.parse(beforeText) as {
    secrets?: Array<{ name: string }>;
  };
  const createdByTest = !(beforeBody.secrets ?? []).some(
    (secret) => secret.name === secretName,
  );

  try {
    await page.goto(`${BASE_URL}/secrets`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Personal Credentials" }),
    ).toBeVisible();
    if (createdByTest) {
      await page.getByRole("button", { name: "New secret" }).click();
      await page.getByLabel("Name").fill(secretName);
      await page.getByLabel("Value").fill(OPENROUTER_KEY);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Secret saved")).toBeVisible();
    }

    const after = await page.request.get(`${BASE_URL}/api/kody/secrets`);
    expect(after.ok()).toBe(true);
    const afterBody = (await after.json()) as {
      secrets?: Array<{ name: string }>;
    };
    expect(
      afterBody.secrets?.some((secret) => secret.name === secretName),
    ).toBe(true);

    await page.goto(`${BASE_URL}/chat`, { waitUntil: "domcontentloaded" });
    const chat = page.locator('[aria-label="Kody chat"]');
    const input = chat.locator("textarea").first();
    await expect(input).toBeEnabled({ timeout: 15_000 });
    const marker = `PERSONAL_SECRET_E2E_${Date.now()}`;
    await input.fill(`Reply with exactly ${marker} and no other text.`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/chat/kody"),
    );
    await chat.getByRole("button", { name: "Send message" }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(chat.getByText(marker, { exact: false }).last()).toBeVisible({
      timeout: 240_000,
    });
  } finally {
    if (createdByTest) {
      await page.request.delete(
        `${BASE_URL}/api/kody/secrets/${encodeURIComponent(secretName)}`,
      );
    }
  }
});
