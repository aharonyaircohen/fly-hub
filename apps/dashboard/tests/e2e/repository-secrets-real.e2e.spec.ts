import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("saves, reloads, reveals, and deletes a real repository secret", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
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
  const marker = `AUDIT_SECRET_${Date.now()}`;

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
        repos: [
          {
            repoUrl: TEST_REPO,
            owner,
            repo,
            token: TEST_TOKEN,
            user,
            addedAt: Date.now(),
            isLogin: true,
          },
        ],
        currentRepoIndex: 0,
      },
    },
  );

  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/secrets`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Repository Secrets" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New secret" }).click();
    await page.getByLabel("Name", { exact: true }).fill(marker);
    await page
      .getByLabel("Value", { exact: true })
      .fill("synthetic-audit-value");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Secret saved", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    const revealed = await page.request.get(
      `${BASE_URL}/api/kody/secrets/${marker}/value`,
      { headers },
    );
    expect(revealed.status()).toBe(200);
    expect((await revealed.json()).value).toBe("synthetic-audit-value");
    await page
      .getByRole("button", { name: `Delete ${marker}`, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: `Delete ${marker}?` })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Repository Secrets" }),
    ).toBeVisible();
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    const removed = await page.request.get(
      `${BASE_URL}/api/kody/secrets/${marker}/value`,
      { headers },
    );
    expect(removed.status()).toBe(404);
  } finally {
    const cleanup = await page.request.delete(
      `${BASE_URL}/api/kody/secrets/${marker}`,
      { headers },
    );
    expect([200, 404]).toContain(cleanup.status());
  }
});
