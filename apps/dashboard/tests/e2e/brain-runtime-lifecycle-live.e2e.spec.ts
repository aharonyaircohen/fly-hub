/**
 * Full destructive Brain lifecycle proof. The shell verifier owns the long
 * save/restore transaction; this mounted-browser test proves its progress and
 * final running image are visible to the user.
 */
import { spawn } from "node:child_process";

import { expect, resolveLiveGitHubUser, test } from "./live-test";
import {
  establishLiveKodyAccountSession,
  loadLiveKodyAccountCredentialsFromDashboard,
} from "./live-account-session";
import { readBrainLifecycleProgress } from "../../scripts/lib/brain-runtime-operation.mjs";

const BASE_URL = process.env.BASE_URL!;
const TOKEN = process.env.E2E_GITHUB_TOKEN!;
const REPOSITORY = new URL(
  process.env.E2E_GITHUB_REPO ?? "https://github.com/invalid/invalid",
);
const [owner, repo] = REPOSITORY.pathname.replace(/^\/+|\/+$/g, "").split("/");
const dashboardRoot = process.cwd();

test.setTimeout(3 * 60 * 60_000);

test("saves, destroys, restores, reconnects, and reads persistent Brain terminal state", async ({
  page,
}) => {
  expect(process.env.KODY_LIVE_BRAIN_DISPOSABLE).toBe("1");
  expect(owner).toBeTruthy();
  expect(repo).toBeTruthy();

  const user = await resolveLiveGitHubUser(page, BASE_URL, {
    "x-kody-token": TOKEN,
    "x-kody-owner": owner!,
    "x-kody-repo": repo!,
  });
  await page.context().addInitScript(
    (auth) => localStorage.setItem("kody_auth", JSON.stringify(auth)),
    {
      repoUrl: `https://github.com/${owner}/${repo}`,
      owner,
      repo,
      token: TOKEN,
      user,
      loggedInAt: Date.now(),
    },
  );
  await page.goto(`${BASE_URL}/fly/brain-images`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Brain Images" })).toBeVisible();
  const credentials = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );
  const signInCookieHeader = await establishLiveKodyAccountSession(
    page.request,
    BASE_URL,
    credentials,
    process.env.E2E_AUTH_ORIGIN ?? BASE_URL,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const cookieHeader =
    signInCookieHeader ||
    (await page.context().cookies(BASE_URL))
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
  expect(cookieHeader, "authenticated lifecycle session cookie").toBeTruthy();

  const child = spawn(
    process.execPath,
    ["scripts/verify-brain-live-flow.mjs", "--require-restore"],
    {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        KODY_LIVE_BASE_URL: BASE_URL,
        KODY_LIVE_GITHUB_TOKEN: TOKEN,
        KODY_LIVE_REPO_SLUG: `${owner}/${repo}`,
        KODY_LIVE_USER_LOGIN: user.login,
        KODY_LIVE_COOKIE: cookieHeader,
        KODY_LIVE_ACCOUNT_EMAIL: credentials.email,
        KODY_LIVE_ACCOUNT_PASSWORD: credentials.password,
        KODY_LIVE_AUTH_ORIGIN: process.env.E2E_AUTH_ORIGIN ?? BASE_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const append = (chunk: string) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.removeAllListeners("data");
  child.stderr.removeAllListeners("data");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  let exitError: Error | null = null;
  let childCompleted = false;
  const completion = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      exitError = error;
      childCompleted = true;
      resolve();
    });
    child.once("close", (code) => {
      if (code !== 0) {
        exitError = new Error(
          `Brain lifecycle verifier failed (${code}): ${output.slice(-4000)}`,
        );
      }
      childCompleted = true;
      resolve();
    });
  });

  try {
    await expect
      .poll(
        async () => {
          return readBrainLifecycleProgress({
            exitError,
            childCompleted,
            readPageText: () => page.locator("body").innerText(),
          });
        },
        { timeout: 2 * 60 * 60_000, intervals: [5_000, 10_000] },
      )
      .toMatch(
        /Pushing the Brain image to GHCR|Restoring Brain image|Brain lifecycle completed/,
      );

    await completion;
    if (exitError) throw exitError;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Running Brain image", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/Brain image restore failed/)).toHaveCount(0);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});
