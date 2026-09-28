import { expect, test } from "./live-test";

const githubToken = process.env.E2E_GITHUB_TOKEN;
const githubRepo = process.env.E2E_GITHUB_REPO;
const repoParts = githubRepo?.match(
  /(?:github\.com\/)?([^/]+)\/([^/]+?)(?:\.git)?$/,
);

test.skip(
  !githubToken || !repoParts,
  "Requires E2E_GITHUB_TOKEN and E2E_GITHUB_REPO for real renderer verification",
);

test("shows built-in renderers in the real management page", async ({
  page,
}) => {
  await page.addInitScript(
    (value) => {
      window.localStorage.setItem("kody_auth", JSON.stringify(value));
    },
    {
      repoUrl: `https://github.com/${repoParts?.[1]}/${repoParts?.[2]}`,
      owner: repoParts?.[1] ?? "",
      repo: repoParts?.[2] ?? "",
      token: githubToken ?? "",
      user: {
        login: "",
        avatar_url: "https://github.com/github-mark.png",
        id: 0,
      },
      loggedInAt: Date.now(),
    },
  );
  await page.goto(`/repo/${repoParts?.[1]}/${repoParts?.[2]}/views/renderers`, {
    waitUntil: "domcontentloaded",
  });

  await expect(
    page.getByRole("heading", { name: "View Renderers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Approval card", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Guided form", { exact: true })).toBeVisible();
  await expect(page.getByText("Selection list", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Multi-select list", { exact: true }),
  ).toBeVisible();
});
