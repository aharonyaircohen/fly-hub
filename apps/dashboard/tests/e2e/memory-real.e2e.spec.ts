import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("creates, revises, reloads, and deletes a real typed memory", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires live repository credentials",
  );
  const { owner, repo } = parseRepo(TEST_REPO);
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

  const marker = `Memory live ${Date.now()}`;
  let memoryId = "";
  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/memory`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Memory", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "New memory" }).click();
    await page.getByLabel("Title").fill(marker);
    await page.getByLabel("Summary").fill("A real memory lifecycle test.");
    await page
      .getByLabel("Details")
      .fill("This record proves real Convex persistence.");
    await page.getByLabel("Reason").fill("Created by the live memory journey.");
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/kody/memory"),
    );
    await page.getByRole("button", { name: "Save" }).click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    memoryId = ((await created.json()) as { memory: { id: string } }).memory.id;
    await expect(
      page.getByRole("heading").filter({ hasText: marker }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit memory" }).click();
    await page
      .getByLabel("Summary")
      .fill("A revised real memory lifecycle test.");
    await page.getByLabel("Reason").fill("Revised by the live memory journey.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("A revised real memory lifecycle test."),
    ).toBeVisible();
    await expect(
      page.getByText("Revised by the live memory journey."),
    ).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading").filter({ hasText: marker }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Revision history")).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete memory" }).click();
    await expect(page).toHaveURL(/\/memory$/, { timeout: 30_000 });
    memoryId = "";
  } finally {
    if (memoryId) {
      const cleanup = await page.request.delete(
        `${BASE_URL}/api/kody/memory/${encodeURIComponent(memoryId)}`,
        { headers },
      );
      expect([200, 404]).toContain(cleanup.status());
    }
  }
});
