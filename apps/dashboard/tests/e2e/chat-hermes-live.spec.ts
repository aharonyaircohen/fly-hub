import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const repositoryUrl = process.env.E2E_GITHUB_REPO ?? "";

test("the mounted Kody chat saves a real Hermes reply and reloads it", async ({ page }) => {
  if (!TOKEN || !repositoryUrl) throw new Error("Live GitHub test credentials are required.");
  const parsed = new URL(repositoryUrl);
  const [owner, repo] = parsed.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) throw new Error("A live test repository is required.");
  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TOKEN, "x-kody-owner": owner, "x-kody-repo": repo,
  });
  await page.addInitScript((auth) => {
    localStorage.setItem("kody_auth", JSON.stringify(auth));
  }, {
    repoUrl: repositoryUrl, owner, repo, token: TOKEN, user,
    loggedInAt: Date.now(),
  });

  let storedId: string | undefined;
  try {
    await page.goto(`${BASE_URL}/chat`);
    const chat = page.locator('[aria-label="Kody chat"]').first();
    await expect(chat).toBeVisible({ timeout: 30_000 });
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/api/kody/hermes/sessions") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "New conversation" }).click();
    const creation = await created;
    expect(creation.ok()).toBe(true);
    const body = await creation.json() as { stored_session_id?: string };
    storedId = body.stored_session_id;
    expect(storedId).toBeTruthy();
    await chat.locator("textarea").first().fill("Reply with only the word turquoise.");
    await chat.getByRole("button", { name: "Send message" }).click();
    await expect(chat.getByText("turquoise", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
    await page.reload();
    await expect(chat.getByText("turquoise", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    if (storedId) await page.request.delete(`${BASE_URL}/api/kody/hermes/sessions/${encodeURIComponent(storedId)}`);
  }
});
