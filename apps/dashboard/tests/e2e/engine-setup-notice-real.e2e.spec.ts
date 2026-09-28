import { expect, test, type Page } from "@playwright/test";

const token = process.env.E2E_GITHUB_TOKEN ?? "";
const repository = process.env.E2E_UNINITIALIZED_GITHUB_REPO ?? "";

async function openMobileChatIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 768) return;
  const openChat = page.getByRole("button", { name: "Open chat" });
  await expect(openChat).toBeVisible();
  await openChat.click();
}

test("a real uninitialized repository can open the built-in Init Engine flow", async ({
  page,
}) => {
  test.skip(!token || !repository, "Live repository credentials are required");

  const url = new URL(repository);
  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  expect(owner).toBeTruthy();
  expect(repo).toBeTruthy();

  await page.addInitScript(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: repository,
      owner,
      repo,
      token,
      user: { login: "live-engine-setup", avatar_url: "", id: 1 },
      loggedInAt: Date.now(),
    },
  );

  await page.goto(`/repo/${owner}/${repo}/guided-flows`, {
    waitUntil: "domcontentloaded",
  });
  await openMobileChatIfNeeded(page);
  await page.getByRole("button", { name: "New conversation" }).click();

  const openingRenderer = page
    .getByTestId("chat-assistant-message")
    .filter({ has: page.getByRole("button", { name: "Setup Kody" }) });
  await expect(openingRenderer).toContainText("Hi! I can help you with:");
  await expect(
    page.getByText("Kody is not set up in this repository"),
  ).toHaveCount(0);
  await openingRenderer.getByRole("button", { name: "Setup Kody" }).click();

  await expect(page).toHaveURL(`/repo/${owner}/${repo}/chat`);
  // The real account may already contain an older run of this flow in the
  // active conversation. The newest matching card proves this launch without
  // assuming an empty persisted chat history.
  await expect(
    page.getByRole("heading", { name: "Prepare the repository" }).last(),
  ).toBeVisible({ timeout: 15_000 });
});
