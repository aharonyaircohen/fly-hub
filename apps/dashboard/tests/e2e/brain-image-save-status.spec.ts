import { expect, test } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

test("shows a failed save instead of polling forever or creating an unhandled error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("500"))
      errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push(request.failure()?.errorText ?? "request failed");
  });
  await page.route("**/api/kody/**", (route) => route.fulfill({ json: {} }));
  await mockDashboardShellRequests(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        owner: "test-owner",
        repo: "test-repo",
        repoUrl: "https://github.com/test-owner/test-repo",
        token: "ghp_placeholder",
        user: { login: "image-test", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.setItem("kody:chat-first-layout", "0");
  });
  await page.route("**/api/kody/fly/config-status", (route) =>
    route.fulfill({ json: { configured: false, source: null } }),
  );
  let polls = 0;
  await page.route("**/api/kody/brain/image**", (route) => {
    if (new URL(route.request().url()).searchParams.has("jobId")) {
      polls++;
      return route.fulfill({
        status: 500,
        json: {
          status: "failed",
          phase: "failed",
          message: "GHCR_TOKEN is missing",
          jobId: "image-job",
        },
      });
    }
    return route.fulfill({
      json: {
        images: [],
        save: {
          status: "running",
          phase: "starting",
          jobId: "image-job",
          imageRef: "ghcr.io/test/brain:saved",
          startedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.goto(
    `${process.env.BASE_URL ?? "http://127.0.0.1:3333"}/repo/test-owner/test-repo/fly/brain-images`,
  );
  await expect(
    page.getByRole("heading", { name: "Brain Images", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "Last save failed: GHCR_TOKEN is missing",
    { timeout: 15000 },
  );
  const count = polls;
  await page.waitForTimeout(5500);
  expect(polls).toBe(count);
  expect(errors).toEqual([]);
});
