import { expect, test, type Page, type Route } from "@playwright/test";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: {
    login: "e2e-test",
    avatar_url: "https://github.com/github-mark.png",
    id: 1,
  },
  loggedInAt: Date.now(),
};

const existingLoop = {
  id: "release-watch",
  trigger: { type: "schedule" as const, every: "1d" },
  target: { kind: "workflow" as const, id: "release-readiness" },
  input: {},
  enabled: true,
  updatedAt: "2026-07-24T10:00:00.000Z",
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockDashboardApis(
  page: Page,
  onWrite: (method: string, body: Record<string, unknown>) => void,
): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);

  await page.route("**/api/kody/auth/me", (route) =>
    fulfillJson(route, {
      authenticated: true,
      user: auth.user,
      owner: auth.owner,
      repo: auth.repo,
    }),
  );
  await page.route("**/api/kody/loops", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      onWrite("POST", body);
      await fulfillJson(route, {
        loop: { ...body, updatedAt: "2026-07-24T11:00:00.000Z" },
      });
      return;
    }
    await fulfillJson(route, { loops: [existingLoop] });
  });
  await page.route("**/api/kody/loops/release-watch", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    onWrite(route.request().method(), body);
    await fulfillJson(route, {
      loop: {
        id: existingLoop.id,
        ...body,
        updatedAt: "2026-07-24T11:00:00.000Z",
      },
    });
  });
  await page.route("**/api/kody/company/workflows", (route) =>
    fulfillJson(route, {
      workflows: [
        {
          id: "release-readiness",
          path: "workflows/release-readiness/workflow.json",
          workflow: {
            name: "Release readiness",
            agent: "developer",
            capabilities: ["verify"],
            createdAt: "2026-07-24T10:00:00.000Z",
            updatedAt: "2026-07-24T10:00:00.000Z",
          },
        },
      ],
    }),
  );
  await page.route("**/api/kody/capabilities", (route) =>
    fulfillJson(route, {
      capabilities: [{ slug: "verify", describe: "Verify release" }],
    }),
  );
}

test.describe("Loops", () => {
  test("creates a condition loop with a real capability target", async ({
    page,
  }) => {
    const writes: Array<{
      method: string;
      body: Record<string, unknown>;
    }> = [];
    await mockDashboardApis(page, (method, body) =>
      writes.push({ method, body }),
    );

    await page.goto("/repo/acme/widgets/agent-loops", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Loops" })).toBeVisible();
    await page.getByLabel("New loop").click();

    const dialog = page.getByRole("dialog", { name: "New loop" });
    await dialog.getByLabel("Loop ID").fill("quality-gate");
    await dialog.getByLabel("Trigger").click();
    await page.getByRole("option", { name: "Condition" }).click();
    await dialog.getByLabel("Condition").fill("facts.testsPassed == false");
    await dialog.getByLabel("Target type").click();
    await page.getByRole("option", { name: "Capability" }).click();
    await dialog.getByLabel("Target", { exact: true }).click();
    await page.getByRole("option", { name: /Verify release/ }).click();
    await dialog.getByRole("button", { name: "Create loop" }).click();

    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      body: {
        id: "quality-gate",
        trigger: {
          type: "condition",
          expression: "facts.testsPassed == false",
        },
        target: { kind: "capability", id: "verify" },
        input: {},
        enabled: true,
      },
    });
  });

  test("edits and disables an existing loop", async ({ page }) => {
    const writes: Array<{
      method: string;
      body: Record<string, unknown>;
    }> = [];
    await mockDashboardApis(page, (method, body) =>
      writes.push({ method, body }),
    );

    await page.goto("/repo/acme/widgets/agent-loops/release-watch", {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit loop" });
    await expect(dialog.getByLabel("Target", { exact: true })).toHaveText(
      /Release readiness/,
    );
    await dialog.getByLabel("Preferred time (optional)").fill("09:30");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]?.method).toBe("PATCH");
    expect(writes[0]?.body).toMatchObject({
      trigger: {
        type: "schedule",
        every: "1d",
        at: { time: "09:30" },
      },
      target: { kind: "workflow", id: "release-readiness" },
      enabled: true,
    });

    await page.getByRole("button", { name: "Disable" }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({
      method: "PATCH",
      body: { enabled: false },
    });
  });
});
