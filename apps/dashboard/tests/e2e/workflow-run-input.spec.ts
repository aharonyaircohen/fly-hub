import { expect, test, type Page } from "@playwright/test";

const BASE_URL =
  process.env.PW_LOCAL === "1"
    ? "http://127.0.0.1:3333"
    : (process.env.BASE_URL ?? "http://127.0.0.1:3333");

async function seedAuth(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "workflow-e2e", avatar_url: "", id: 42 },
        loggedInAt: Date.now(),
      }),
    );
  });
}

test("collects workflow input and completes the one-time approval handshake", async ({
  page,
}) => {
  const runBodies: Array<Record<string, unknown>> = [];
  let approvalBody: Record<string, unknown> | null = null;
  await seedAuth(page);

  await page.route("**/api/kody/company/workflows", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            id: "documentation-agency",
            path: "catalog/workflows/documentation-agency/workflow.json",
            source: "store",
            readOnly: true,
            runnable: true,
            workflow: {
              name: "Documentation Agency",
              agent: "documentation-lead",
              capabilities: ["define-documentation-brief"],
              inputSchema: {
                type: "object",
                properties: {
                  issue: {
                    type: "integer",
                    minimum: 1,
                    description: "GitHub issue containing the documentation brief.",
                  },
                },
                required: ["issue"],
                additionalProperties: false,
              },
              createdAt: "2026-07-30T10:00:00.000Z",
              updatedAt: "2026-07-30T10:00:00.000Z",
            },
          },
        ],
      }),
    }),
  );
  await page.route(
    "**/api/kody/company/workflows/documentation-agency/run",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      runBodies.push(body);
      if (body.approvalId !== "approval-one") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "approval_required",
            approvalToken: "server.challenge",
            approvalExpiresAt: "2026-07-30T10:15:00.000Z",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          execution: "kody-engine",
          workflow: "documentation-agency",
          runId: "run-one",
          acceptedAt: "2026-07-30T10:01:00.000Z",
        }),
      });
    },
  );
  await page.route(
    "**/api/kody/company/workflows/documentation-agency/approve",
    async (route) => {
      approvalBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ approvalId: "approval-one" }),
      });
    },
  );
  await page.route(
    "**/api/kody/company/workflows/documentation-agency/runs**",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ run: null }),
      }),
  );
  await page.route("**/api/kody/capabilities", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ capabilities: [] }),
    }),
  );
  await page.route("**/api/kody/agents", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ agent: [] }),
    }),
  );
  await page.route("**/api/kody/cto/trust", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ capabilities: {}, subjects: {}, log: [] }),
    }),
  );

  await page.goto(`${BASE_URL}/workflows/documentation-agency`);
  await page
    .getByRole("button", { name: "Run workflow documentation-agency" })
    .click();
  const inputDialog = page.getByRole("dialog", {
    name: "Run Documentation Agency",
  });
  await inputDialog.getByLabel("issue *").fill("42");
  await inputDialog.getByRole("button", { name: "Continue" }).click();

  const approvalDialog = page.getByRole("dialog", {
    name: "Run Documentation Agency?",
  });
  await approvalDialog
    .getByRole("button", { name: "Approve and run" })
    .click();

  await expect.poll(() => runBodies.length).toBe(2);
  expect(runBodies).toEqual([
    { input: { issue: 42 } },
    { approvalId: "approval-one", input: { issue: 42 } },
  ]);
  expect(approvalBody).toEqual({
    approvalToken: "server.challenge",
    input: { issue: 42 },
  });
  await expect(page.getByText("Run run-one accepted by Kody Engine.")).toBeVisible();
});
