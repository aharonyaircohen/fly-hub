import { expect, test, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

const qualityMap = {
  actions: [
    {
      slug: "send-message",
      name: "Send a message",
      outcome: "The user sends one chat message.",
      area: "Chat",
      status: "active",
      updatedAt: "2026-08-09T12:00:00.000Z",
    },
  ],
  journeys: [
    {
      slug: "direct-chat-persists",
      name: "Direct chat survives reload",
      goal: "A user can return to a saved direct chat.",
      priority: "critical",
      status: "active",
      actionSlugs: ["send-message"],
      updatedAt: "2026-08-09T12:00:00.000Z",
    },
  ],
  scenarios: [
    {
      slug: "reply-persists",
      journeySlugs: ["direct-chat-persists"],
      name: "Reply persists after reload",
      kind: "persistence",
      given: "A connected repository and configured direct model.",
      expectedVisible: "The same reply is visible after reload.",
      expectedState: "The conversation and messages remain stored.",
      environmentId: "production",
      cleanup: "Remove the test conversation.",
      status: "active",
      updatedAt: "2026-08-09T12:00:00.000Z",
    },
  ],
  runs: [
    {
      runId: "run-1",
      runSlug: "reply-persists-20260809",
      journeySlugs: ["direct-chat-persists"],
      scenarioSlug: "reply-persists",
      environment: "local",
      targetUrl: "http://127.0.0.1:3333",
      sourceCommit: "abc123",
      definitionUpdatedAt: "2026-08-09T12:00:00.000Z",
      status: "passed",
      latestEvent: {
        type: "quality_run_completed",
        summary: "Direct chat persistence passed.",
        artifactPath: "apps/dashboard/test-results/live-ui-gate/run-1",
        artifactUrl: "https://github.com/acme/widgets/actions/runs/42",
        passed: 1,
        failed: 0,
        blocked: 0,
        usage: {
          version: 1,
          tokens: {
            input: 709_564,
            output: 2_091,
            cacheRead: 1_536,
            cacheCreate: 0,
            total: 713_191,
          },
          costUsd: 2.1769996,
          agentRuns: 1,
          turns: 20,
          measurement: "reported",
          byModel: {
            "minimax/MiniMax-M3": {
              tokens: {
                input: 709_564,
                output: 2_091,
                cacheRead: 1_536,
                cacheCreate: 0,
                total: 713_191,
              },
              costUsd: 2.1605178,
              agentRuns: 1,
              turns: 20,
              measurement: "reported",
            },
          },
        },
        journeyResults: [
          {
            journeySlug: "direct-chat-persists",
            journeyName: "Direct chat survives reload",
            status: "passed",
            evidence: "The complete Journey passed.",
            artifactPath:
              "test-results/quality-runs/run-1/01-direct-chat-persists.png",
          },
        ],
        actionResults: [
          {
            actionSlug: "send-message",
            actionName: "Send a message",
            status: "passed",
            evidence: "A fresh message remained visible after reload.",
            artifactPath: "test-results/quality-runs/run-1/01-send-message.png",
          },
        ],
      },
      createdAt: "2026-08-09T12:00:00.000Z",
      updatedAt: "2026-08-09T12:02:00.000Z",
    },
  ],
  currentSourceCommit: "abc123",
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await page.route("**/api/kody/quality/**", (route) =>
    json(route, qualityMap),
  );
  await page.route("**/api/kody/dashboard-config", (route) =>
    json(route, {
      config: {
        version: 1,
        namedPreviews: [
          {
            id: "production",
            label: "Production",
            url: "https://widgets.example.com",
          },
        ],
      },
    }),
  );
});

for (const pageCase of [
  {
    path: "actions",
    title: "Actions",
    item: "Send a message",
    slug: "send-message",
    count: "1 action",
  },
  {
    path: "journeys",
    title: "Journeys",
    item: "Direct chat survives reload",
    slug: "direct-chat-persists",
    count: "1 journey",
  },
  {
    path: "scenarios",
    title: "Scenarios",
    item: "Reply persists after reload",
    slug: "reply-persists",
    count: "1 scenario",
  },
  {
    path: "runs",
    title: "Quality Runs",
    item: "Reply persists after reload",
    slug: "reply-persists-20260809",
    count: "1 quality run",
  },
] as const) {
  test(`manages ${pageCase.title} from a repository-scoped page`, async ({
    page,
  }) => {
    await page.goto(`/repo/acme/widgets/quality/${pageCase.path}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: pageCase.title, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(pageCase.item, { exact: true })).toBeVisible();
    await expect(page.getByText(pageCase.count, { exact: true })).toBeVisible();
    await expect(page.getByText(pageCase.slug, { exact: true })).toHaveCount(0);
    await expect(
      page.getByPlaceholder(`Search ${pageCase.path}…`),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/repo/acme/widgets/quality/${pageCase.path}$`),
    );

    await page.getByRole("button", { name: new RegExp(pageCase.item) }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/repo/acme/widgets/quality/${pageCase.path}/${pageCase.slug}$`,
      ),
    );
    await expect(
      page.getByRole("heading", { name: pageCase.item, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(pageCase.slug, { exact: true })).toBeVisible();
  });
}

test("creates, edits, and deletes an Action", async ({ page }) => {
  let actions: typeof qualityMap.actions = [];
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      actions = [route.request().postDataJSON()];
      return json(route, { ok: true }, 201);
    }
    if (method === "DELETE") {
      actions = [];
      return route.fulfill({ status: 204 });
    }
    return json(route, { ...qualityMap, actions });
  });

  await page.goto("/repo/acme/widgets/quality/actions");
  await page.getByRole("button", { name: "New action" }).click();
  await expect(
    page.getByText(
      "An Action is one simple user step. Describe its expected result, not clicks or selectors.",
    ),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Open a conversation");
  await page.getByLabel("Expected result").fill("The user opens Chat.");
  await page.getByLabel("Product area").fill("Chat");
  await expect(page.getByText("Browser steps", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("Open a conversation", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Expected result").fill("The user opens a saved Chat.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("The user opens a saved Chat.")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .last()
    .click();
  await expect(page.getByText("No Actions yet")).toBeVisible();
});

test("saves an Action without asking the user for browser instructions", async ({
  page,
}) => {
  let savedAction: Record<string, unknown> | null = null;
  await page.route("**/api/kody/quality/actions", async (route) => {
    if (route.request().method() === "POST") {
      savedAction = route.request().postDataJSON();
      return json(route, { ok: true }, 201);
    }
    return json(route, { ...qualityMap, actions: [] });
  });

  await page.goto("/repo/acme/widgets/quality/actions");
  await page.getByRole("button", { name: "New action" }).click();
  await page.getByLabel("Name").fill("Sign in");
  await page.getByLabel("Expected result").fill("The user signs in.");
  await page.getByLabel("Product area").fill("Authentication");
  await page.getByLabel("Status").selectOption("active");
  await expect(page.getByText("Browser steps", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();

  expect(savedAction).toMatchObject({
    name: "Sign in",
    outcome: "The user signs in.",
    area: "Authentication",
    status: "active",
  });
  expect(savedAction).not.toHaveProperty("steps");
  expect(JSON.stringify(savedAction)).not.toContain("e2e-token");
});

test("binds a Scenario to a repository environment", async ({ page }) => {
  let scenarios: typeof qualityMap.scenarios = [];
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    if (route.request().method() === "POST") {
      scenarios = [route.request().postDataJSON()];
      return json(route, { ok: true }, 201);
    }
    return json(route, { ...qualityMap, scenarios });
  });

  await page.goto("/repo/acme/widgets/quality/scenarios");
  await page.getByRole("button", { name: "New scenario" }).click();
  await page.getByLabel("Name").fill("Production chat opens");
  await page.getByLabel("Starting conditions").fill("Production is available.");
  await page.getByLabel("Visible proof").fill("Chat is visible.");
  await page
    .getByLabel("Stored-state proof")
    .fill("No state change is needed.");
  await expect(page.getByLabel("Website to test")).toHaveValue("production");
  await page.getByLabel("Status").selectOption("active");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("Production chat opens", { exact: true }).first(),
  ).toBeVisible();
  expect(scenarios[0]?.environmentId).toBe("production");
  expect(scenarios[0]?.journeySlugs).toEqual(["direct-chat-persists"]);
  expect(scenarios[0]).not.toHaveProperty("testId");
});

test("keeps an existing single-Journey Scenario readable during migration", async ({
  page,
}) => {
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", (route) =>
    json(route, {
      ...qualityMap,
      scenarios: [
        {
          ...qualityMap.scenarios[0],
          journeySlugs: undefined,
          journeySlug: "direct-chat-persists",
          environmentId: undefined,
        },
      ],
    }),
  );

  await page.goto("/repo/acme/widgets/quality/scenarios/reply-persists");

  await expect(
    page.getByRole("heading", { name: "Reply persists after reload" }),
  ).toBeVisible();
  await expect(
    page.getByText("Direct chat survives reload", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("This page hit an error")).toHaveCount(0);
});

test("orders reusable Journeys inside a Scenario", async ({ page }) => {
  let savedScenario: Record<string, unknown> | null = null;
  const journeys = [
    ...qualityMap.journeys,
    {
      slug: "sign-in",
      name: "Sign in",
      goal: "A valid test user signs in.",
      priority: "normal",
      status: "active",
      actionSlugs: ["send-message"],
      updatedAt: "2026-08-09T12:00:00.000Z",
    },
  ];
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    if (route.request().method() === "POST") {
      savedScenario = route.request().postDataJSON();
      return json(route, { ok: true }, 201);
    }
    return json(route, { ...qualityMap, journeys, scenarios: [] });
  });

  await page.goto("/repo/acme/widgets/quality/scenarios");
  await page.getByRole("button", { name: "New scenario" }).click();
  await expect(
    page.getByText(
      "A Scenario orders Journeys into one complete test with starting conditions and required proof.",
    ),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Signed-in user completes work");
  await page.getByRole("button", { name: "Add Sign in" }).click();
  await page.getByRole("button", { name: "Move Sign in up" }).click();
  await page.getByLabel("Starting conditions").fill("Production is available.");
  await page.getByLabel("Visible proof").fill("A fresh reply is visible.");
  await page
    .getByLabel("Stored-state proof")
    .fill("The fresh reply survives reload.");
  await page.getByRole("button", { name: "Save" }).click();

  expect(savedScenario).toMatchObject({
    journeySlugs: ["sign-in", "direct-chat-persists"],
  });
});

test("explains that a Journey is one user goal made from simple Actions", async ({
  page,
}) => {
  await page.goto("/repo/acme/widgets/quality/journeys");
  await page.getByRole("button", { name: "New journey" }).click();

  await expect(
    page.getByText(
      "A Journey combines simple Actions to complete one user goal. Do not repeat setup owned by another Journey.",
    ),
  ).toBeVisible();
});

test("offers only active records when composing Quality models", async ({
  page,
}) => {
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) =>
    json(route, {
      ...qualityMap,
      actions: [
        ...qualityMap.actions,
        {
          ...qualityMap.actions[0],
          slug: "archived-action",
          name: "Archived action",
          status: "archived",
        },
      ],
      journeys: [
        {
          ...qualityMap.journeys[0],
          slug: "archived-journey",
          name: "Archived journey",
          status: "archived",
        },
        ...qualityMap.journeys,
      ],
    }),
  );

  await page.goto("/repo/acme/widgets/quality/journeys");
  await page.getByRole("button", { name: "New journey" }).click();
  await expect(
    page.getByRole("button", { name: "Add Archived action" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/repo/acme/widgets/quality/scenarios");
  await page.getByRole("button", { name: "New scenario" }).click();
  await expect(page.getByText("1. Archived journey")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add Archived journey" }),
  ).toHaveCount(0);
});

test("starts an active Scenario without manual browser steps", async ({
  page,
}) => {
  let startedScenario = "";
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    if (
      route.request().method() === "POST" &&
      new URL(route.request().url()).pathname.endsWith("/quality/runs")
    ) {
      startedScenario = route.request().postDataJSON().scenarioSlug;
      return json(
        route,
        {
          runId: "run-agent",
          runSlug: "reply-persists-agent",
          status: "running",
        },
        202,
      );
    }
    return json(route, qualityMap);
  });

  await page.goto("/repo/acme/widgets/quality/runs");
  await page.getByRole("button", { name: "New Quality Run" }).click();
  await expect(
    page.getByText(
      "Kody will act as a live user and run the Scenario's Journeys in order.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start Quality Run" }).click();

  expect(startedScenario).toBe("reply-persists");
});

test("shows the verified result for every Journey and Action in a Quality Run", async ({
  page,
}) => {
  await page.goto("/repo/acme/widgets/quality/runs/reply-persists-20260809");

  await expect(page.getByText("1 passed", { exact: true })).toBeVisible();
  await expect(page.getByText("0 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Send a message", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Direct chat survives reload", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A fresh message remained visible after reload."),
  ).toBeVisible();
});

test("shows compact model usage in a Quality Run report", async ({ page }) => {
  const qualityResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/kody/quality/runs"),
  );
  await page.goto("/repo/acme/widgets/quality/runs/reply-persists-20260809");

  const qualityPayload = (await (await qualityResponse).json()) as typeof qualityMap;
  expect(qualityPayload.runs[0]?.latestEvent.usage?.tokens.total).toBe(713_191);

  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  await expect(page.getByText("713,191 tokens", { exact: true })).toBeVisible();
  await expect(page.getByText("$2.1770", { exact: true })).toBeVisible();
  await expect(page.getByText("20 turns", { exact: true })).toBeVisible();
  await expect(page.getByText("Reported", { exact: true })).toBeVisible();

  await page.getByText("By model", { exact: true }).click();
  await expect(
    page.getByText("minimax/MiniMax-M3", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/\$2\.1605/)).toBeVisible();
});

test("hides usage when an older Quality Run has no usage evidence", async ({
  page,
}) => {
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", (route) =>
    json(route, {
      ...qualityMap,
      runs: qualityMap.runs.map((run) => ({
        ...run,
        latestEvent: { ...run.latestEvent, usage: undefined },
      })),
    }),
  );

  await page.goto("/repo/acme/widgets/quality/runs/reply-persists-20260809");

  await expect(page.getByRole("heading", { name: "Usage" })).toHaveCount(0);
});

test("explains a failed Quality Run and links to the record that needs correction", async ({
  page,
}) => {
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", (route) =>
    json(route, {
      ...qualityMap,
      runs: qualityMap.runs.map((run) => ({
        ...run,
        status: "failed",
        error: "The repository was saved but not selected.",
        latestEvent: {
          ...run.latestEvent,
          summary: "The test stayed in global Chat.",
          passed: 0,
          failed: 1,
          blocked: 0,
          actionResults: [
            {
              actionSlug: "send-message",
              actionName: "Send a message",
              status: "failed",
              evidence:
                "The repository appeared in the list, but Chat stayed global and the message box was disabled.",
              issueSource: "test",
              cause:
                "The test tried to add a repository that was already saved instead of selecting it.",
              correction:
                "Select the existing repository before sending the message.",
              artifactPath:
                "test-results/quality-runs/run-1/01-send-message.png",
            },
          ],
          scenarioResult: {
            status: "failed",
            evidence: "The expected reply was never created.",
            issueSource: "test",
            cause:
              "The Action instruction did not activate the saved repository.",
            correction:
              "Correct the failed Action and run this Scenario again.",
            artifactPath: "test-results/quality-runs/run-1/final.png",
          },
        },
      })),
    }),
  );

  await page.goto("/repo/acme/widgets/quality/runs/reply-persists-20260809");

  await expect(
    page.getByRole("heading", { name: "What happened" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The repository appeared in the list, but Chat stayed global and the message box was disabled.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The test tried to add a repository that was already saved instead of selecting it.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Select the existing repository before sending the message.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Action" })).toHaveAttribute(
    "href",
    "/repo/acme/widgets/quality/actions/send-message",
  );
  await expect(
    page.getByRole("link", { name: "Edit Scenario" }),
  ).toHaveAttribute(
    "href",
    "/repo/acme/widgets/quality/scenarios/reply-persists",
  );
});

test("does not present missing Quality totals as zero", async ({ page }) => {
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", (route) =>
    json(route, {
      ...qualityMap,
      runs: qualityMap.runs.map((run) => ({
        ...run,
        latestEvent: {
          type: "quality_run_completed",
          summary: "The old result did not include verified Action totals.",
        },
      })),
    }),
  );

  await page.goto("/repo/acme/widgets/quality/runs/reply-persists-20260809");

  await expect(
    page.getByText("Results unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 passed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 failed", { exact: true })).toHaveCount(0);
});

test("archives and restores a Quality Run while keeping its evidence", async ({
  page,
}) => {
  let runs = qualityMap.runs.map((run) => ({ ...run, archived: false }));
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        runId: string;
        archived: boolean;
      };
      runs = runs.map((run) =>
        run.runId === body.runId ? { ...run, archived: body.archived } : run,
      );
      return json(route, { ok: true, archived: body.archived });
    }
    return json(route, { ...qualityMap, runs });
  });

  await page.goto("/repo/acme/widgets/quality/runs");
  await page
    .getByRole("button", { name: /Reply persists after reload/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Quality evidence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("button", { name: "Archive", exact: true })
    .last()
    .click();
  await expect(page.getByText("Quality Run archived")).toBeVisible();
  await expect(page).toHaveURL(/\/repo\/acme\/widgets\/quality\/runs$/);
  await expect(page.getByText("No Quality Runs yet")).toBeVisible();

  await page.getByRole("button", { name: "Show archived" }).click();
  await page
    .getByRole("button", { name: /Reply persists after reload/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Quality evidence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Restore" }).last().click();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
});

test("cancels a running Quality Run from its detail view", async ({ page }) => {
  let runs = qualityMap.runs.map((run) => ({
    ...run,
    status: "running" as "running" | "cancelled",
    archived: false,
  }));
  await page.unroute("**/api/kody/quality/**");
  await page.route("**/api/kody/quality/**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        action?: string;
        runId: string;
      };
      runs = runs.map((run) =>
        run.runId === body.runId && body.action === "cancel"
          ? { ...run, status: "cancelled" as const }
          : run,
      );
      return json(route, { ok: true, status: "cancelled" });
    }
    return json(route, { ...qualityMap, runs });
  });

  await page.goto("/repo/acme/widgets/quality/runs");
  await page
    .getByRole("button", { name: /Reply persists after reload/ })
    .click();
  await expect(
    page.getByRole("button", { name: /Cancel Reply persists after reload/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Cancel Reply persists after reload/ })
    .click();
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await expect(page.getByText("Quality Run cancelled")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Cancel Reply persists after reload/ }),
  ).toHaveCount(0);
});
