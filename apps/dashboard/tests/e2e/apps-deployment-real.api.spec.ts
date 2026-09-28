/** @testFramework playwright @domain e2e-live */
import crypto from "node:crypto";
import { expect, test } from "./live-test";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const OWNER = "aharonyaircohen";
const REPO = "kody-chat";

test("repairs, starts, and opens the real managed App through its APIs", async ({
  page,
}) => {
  test.setTimeout(900_000);
  test.skip(!BASE_URL || !TOKEN, "Requires the local target and QA account");
  const headers = {
    "x-kody-token": TOKEN,
    "x-kody-owner": OWNER,
    "x-kody-repo": REPO,
  };

  const initial = await page.request.get(`${BASE_URL}/api/kody/apps`, {
    headers,
  });
  expect(initial.ok(), await initial.text()).toBe(true);

  const deployments = await page.request.get(
    `${BASE_URL}/api/kody/apps/open-notebook/deployments`,
    { headers },
  );
  expect(deployments.ok(), await deployments.text()).toBe(true);
  const history = (await deployments.json()) as {
    deployments?: Array<{ commitSha: string }>;
  };
  const commitSha = history.deployments?.[0]?.commitSha;
  expect(commitSha).toMatch(/^[a-f0-9]{40}$/);
  const deploy = await page.request.post(
    `${BASE_URL}/api/kody/apps/open-notebook/deployments`,
    {
      headers,
      data: { requestId: crypto.randomUUID(), commitSha },
    },
  );
  expect(deploy.status(), await deploy.text()).toBe(202);

  const start = await page.request.post(
    `${BASE_URL}/api/kody/apps/open-notebook/actions`,
    { headers, data: { action: "start" } },
  );
  expect([200, 202, 409], await start.text()).toContain(start.status());

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${BASE_URL}/api/kody/apps`, {
          headers,
        });
        const body = (await response.json()) as {
          apps?: Array<{ slug: string; observedStatus: string }>;
        };
        return body.apps?.find((app) => app.slug === "open-notebook")
          ?.observedStatus;
      },
      { timeout: 720_000, intervals: [5_000] },
    )
    .toBe("running");

  const open = await page.request.post(
    `${BASE_URL}/api/kody/apps/open-notebook/open`,
    { headers },
  );
  expect(open.ok(), await open.text()).toBe(true);
  const { url } = (await open.json()) as { url: string };
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText("request_auth_required");
  await expect(page.getByText("Unable to Connect to API Server")).toHaveCount(
    0,
  );
  await expect
    .poll(() => page.evaluate(async () => (await fetch("/api/config")).status))
    .toBeLessThan(500);
  expect(new URL(page.url()).searchParams.has("ka")).toBe(false);
});
