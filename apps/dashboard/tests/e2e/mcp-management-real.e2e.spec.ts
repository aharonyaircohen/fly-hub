/** @testFramework playwright @domain e2e-live */
import { expect, resolveLiveGitHubUser, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TEST_TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "";

function parseRepo(value: string) {
  const path = value.includes("://") ? new URL(value).pathname : value;
  const [owner = "", repo = ""] = path.replace(/^\/+|\/+$/g, "").split("/");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

test("creates, verifies, and revokes a real repository-scoped MCP connection", async ({
  page,
}) => {
  test.skip(
    !BASE_URL || !TEST_TOKEN || !TEST_REPO,
    "Requires a live repository",
  );

  const { owner, repo } = parseRepo(TEST_REPO);
  const name = `Browser MCP ${Date.now()}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-kody-token": TEST_TOKEN,
    "x-kody-owner": owner,
    "x-kody-repo": repo,
  };
  const user = await resolveLiveGitHubUser(page, BASE_URL, headers);
  const repositoryAuth = {
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
  };

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    repositoryAuth,
  );

  let tokenId = "";
  try {
    await page.goto(`${BASE_URL}/repo/${owner}/${repo}/mcp`);
    await expect(
      page.getByRole("heading", { name: "Agent connections" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create connection" }).click();
    await page.getByLabel("Connection name").fill(name);
    await page.getByLabel("Access", { exact: true }).selectOption("read");
    const verificationResponse = page.waitForResponse(
      (response) =>
        response.url() === `${BASE_URL}/api/kody/mcp` &&
        response.request().method() === "POST",
    );
    const issuanceResponse = page.waitForResponse(
      (response) =>
        response.url() === `${BASE_URL}/api/kody/mcp/tokens` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create token" }).click();
    const issued = await issuanceResponse;
    expect(issued.status()).toBe(201);
    const issuanceBody = (await issued.json()) as {
      token: { tokenId: string };
    };
    tokenId = issuanceBody.token.tokenId;
    expect(issued.request().headers()).toMatchObject({
      "x-kody-owner": owner,
      "x-kody-repo": repo,
    });
    expect(Boolean(issued.request().headers()["x-kody-token"])).toBe(true);
    const verified = await verificationResponse;
    const verificationBody = (await verified.json()) as Record<string, unknown>;
    await expect(
      page.getByRole("dialog", { name: "Save this token now" }),
    ).toBeVisible();

    const listed = await page.request.get(`${BASE_URL}/api/kody/mcp/tokens`, {
      headers,
    });
    expect(listed.status(), await listed.text()).toBe(200);
    const body = (await listed.json()) as {
      tokens: Array<{ tokenId: string; name: string; scopes: string[] }>;
    };
    const created = body.tokens.find((token) => token.name === name);
    expect(created?.scopes).toEqual(["mcp:read", "memory:repository:read"]);
    tokenId = created?.tokenId ?? "";

    expect({ status: verified.status(), body: verificationBody }).toMatchObject(
      {
        status: 200,
        body: { result: { isError: false } },
      },
    );
    await expect(page.getByText("Connection ready")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(name)).toBeVisible();

    await page.getByRole("button", { name: `Revoke ${name}` }).click();
    await expect(page.getByText(name)).toHaveCount(0);
    tokenId = "";
  } finally {
    if (tokenId) {
      await page.request.delete(`${BASE_URL}/api/kody/mcp/tokens`, {
        headers,
        data: { tokenId },
      });
    }
  }
});
