import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("creates, persists, and deletes real agent constraints and policies", async ({
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
  const marker = `guidance-e2e-${Date.now()}`;

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

  async function removeIfPresent(kind: "constraints" | "policies") {
    const response = await page.request.delete(
      `${BASE_URL}/api/kody/${kind}/${marker}`,
      { headers },
    );
    if (![200, 404].includes(response.status())) {
      throw new Error(
        `Cleanup ${kind}/${marker} failed: ${response.status()} ${await response.text()}`,
      );
    }
  }

  try {
    for (const kind of ["constraints", "policies"] as const) {
      const title = kind === "constraints" ? "Constraints" : "Policies";
      await page.goto(`${BASE_URL}/repo/${owner}/${repo}/${kind}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await page.getByRole("button", { name: "More file actions" }).click();
      await page.getByRole("menuitem", { name: "New file" }).click();
      const dialog = page.getByRole("dialog", { name: "New file" });
      await dialog
        .getByPlaceholder(
          kind === "constraints" ? "Constraint name" : "Policy name",
        )
        .fill(marker);
      await dialog.getByRole("button", { name: "Create" }).click();

      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${BASE_URL}/api/kody/${kind}/${marker}`,
            { headers },
          );
          return response.status();
        })
        .toBe(200);

      await page.goto(`${BASE_URL}/repo/${owner}/${repo}/${kind}`, {
        waitUntil: "domcontentloaded",
      });
      const deletion = await page.request.delete(
        `${BASE_URL}/api/kody/${kind}/${marker}`,
        { headers, timeout: 30_000 },
      );
      expect(deletion.status()).toBe(200);
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${BASE_URL}/api/kody/${kind}/${marker}`,
            { headers },
          );
          return response.status();
        })
        .toBe(404);
    }
  } finally {
    await removeIfPresent("constraints");
    await removeIfPresent("policies");
  }
});
