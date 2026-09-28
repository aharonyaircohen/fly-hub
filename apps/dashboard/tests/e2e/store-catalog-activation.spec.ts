/**
 * @fileoverview Store Catalog add-reference browser tests.
 * @testFramework playwright
 * @domain e2e
 *
 * Runs the real catalog UI with mocked catalog/import APIs so the browser flow
 * verifies that "Add from Store" links Store models without local copies.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

type CatalogKind =
  | "agent"
  | "capability"
  | "loop"
  | "trigger"
  | "workflow"
  | "command"
  | "solution"
  | "blueprint";

interface CatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogKind;
  htmlUrl: string | null;
  installed?: boolean;
  uninstallBlockedBy?: Array<{
    kind: CatalogKind;
    slug: string;
    title?: string;
  }>;
  blueprint?: {
    version: string;
    constraints: string[];
    verification: string[];
    repositoryTypes: string[];
    providers: string[];
  };
}

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

const catalogSeeds: CatalogItem[] = [
  {
    slug: "atlas-agent",
    title: "Atlas Agent",
    description: "Coordinates product delivery.",
    kind: "agent",
    htmlUrl: null,
  },
  {
    slug: "release-watch",
    title: "Release Watch",
    description: "Keeps release work moving.",
    kind: "capability",
    htmlUrl: null,
  },
  {
    slug: "bug-flow",
    title: "Bug Flow",
    description: "Reproduces, plans, implements, reviews, and fixes feedback.",
    kind: "workflow",
    htmlUrl: null,
  },
  {
    slug: "daily-triage",
    title: "Daily Triage",
    description: "Repeats triage on a schedule.",
    kind: "loop",
    htmlUrl: null,
  },
  {
    slug: "ci-repair-on-ci-failure",
    title: "CI Repair on CI failure",
    description: "Starts CI Repair when repository CI fails.",
    kind: "trigger",
    htmlUrl: null,
  },
  {
    slug: "release-workflow",
    title: "Release Workflow",
    description: "Runs release readiness capabilities in order.",
    kind: "workflow",
    htmlUrl: null,
  },
  {
    slug: "factory",
    title: "/factory",
    description: "Draft factory changes.",
    kind: "command",
    htmlUrl: null,
  },
  {
    slug: "healthy-ci",
    title: "Healthy CI",
    description: "Build repository-native CI and keep it passing.",
    kind: "blueprint",
    htmlUrl: "https://github.com/acme/store/tree/main/strategies/healthy-ci",
    blueprint: {
      version: "1.0.0",
      constraints: ["Create a pull request; do not merge it"],
      verification: ["Repository CI passes"],
      repositoryTypes: ["javascript", "typescript"],
      providers: ["github-actions"],
    },
  },
];

const solutionSeeds = [
  {
    slug: "web-release",
    title: "Web Release",
    description: "Validate, merge, and deploy web releases.",
    kind: "solution" as const,
    htmlUrl: "https://github.com/acme/store/tree/main/solutions/web-release",
    installed: false,
    status: "available" as const,
    tree: [
      {
        kind: "loop" as const,
        slug: "daily-web-release-loop",
        title: "Daily Web Release Loop",
        installed: false,
        children: [
          {
            kind: "workflow" as const,
            slug: "web-release",
            title: "Web Release Workflow",
            installed: false,
            children: [
              {
                kind: "capability" as const,
                slug: "release-prepare",
                title: "Release Prepare",
                installed: false,
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
}

async function mockStoreCatalog(page: Page): Promise<unknown[]> {
  const imports: unknown[] = [];
  await page.route("**/api/kody/store-catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        solutions: solutionSeeds,
        items: catalogSeeds,
      }),
    });
  });

  await page.route("**/api/kody/store-catalog/import", async (route) => {
    const body = route.request().postDataJSON() as {
      kind: CatalogKind;
      slug: string;
    };
    imports.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: body.kind,
        slug: body.slug,
        imported: true,
        status: "imported",
        path: `company.active.${body.slug}`,
      }),
    });
  });

  return imports;
}

async function mockStoreCatalogWithInstallState(
  page: Page,
): Promise<Array<{ method: string; kind: CatalogKind; slug: string }>> {
  const requests: Array<{ method: string; kind: CatalogKind; slug: string }> =
    [];
  const items = catalogSeeds.map((item) => ({
    ...item,
    installed:
      (item.kind === "command" && item.slug === "factory") ||
      (item.kind === "capability" && item.slug === "release-watch"),
    uninstallBlockedBy:
      item.kind === "capability" && item.slug === "release-watch"
        ? [
            {
              kind: "workflow" as const,
              slug: "release-workflow",
              title: "Release Workflow",
            },
          ]
        : [],
  }));

  await page.route("**/api/kody/store-catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ solutions: solutionSeeds, items }),
    });
  });

  await page.route("**/api/kody/store-catalog/import", async (route) => {
    const body = route.request().postDataJSON() as {
      kind: CatalogKind;
      slug: string;
    };
    const method = route.request().method();
    requests.push({ method, ...body });
    const item = items.find(
      (candidate) =>
        candidate.kind === body.kind && candidate.slug === body.slug,
    );
    if (item) item.installed = method !== "DELETE";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        method === "DELETE"
          ? {
              kind: body.kind,
              slug: body.slug,
              removed: true,
              status: "removed",
              path: `company.active.${body.slug}`,
            }
          : {
              kind: body.kind,
              slug: body.slug,
              imported: true,
              status: "imported",
              path: `company.active.${body.slug}`,
            },
      ),
    });
  });

  return requests;
}

async function mockIdentity(page: Page): Promise<void> {
  await page.route("**/api/kody/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        user: {
          login: "e2e-test",
          avatar_url: "https://github.com/github-mark.png",
          githubId: 1,
        },
        owner: "acme",
        repo: "widgets",
      }),
    });
  });
}

async function openStoreCatalog(page: Page): Promise<void> {
  await seedAuth(page);
  await mockIdentity(page);
  await page.goto("/store-catalog?filter=all", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Store Catalog" }),
  ).toBeVisible({ timeout: 10_000 });
}

async function openStoreSolutions(page: Page): Promise<void> {
  await seedAuth(page);
  await mockIdentity(page);
  await page.goto("/store-catalog", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Store Catalog" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "Start with a complete Solution" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Solutions" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Browse components" }),
  ).toBeVisible();
}

async function closeCatalogModal(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function addCatalogItem(
  page: Page,
  item: { kind: CatalogKind; slug: string },
): Promise<void> {
  await page.goto(`/store-catalog/${item.kind}/${item.slug}`, {
    waitUntil: "domcontentloaded",
  });

  const button = page.getByTestId(
    `store-catalog-import-${item.kind}-${item.slug}`,
  );
  await expect(button).toContainText("Install");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/kody/store-catalog/import") &&
        response.status() === 200,
    ),
    button.click(),
  ]);
  await expect(button).toContainText("Install");
}

test.describe("Store", () => {
  test("starts the generated Create Blueprint flow from Strategy Blueprints", async ({
    page,
  }) => {
    await mockStoreCatalog(page);
    let startedFlow: { flowId?: string; instanceKey?: string } | null = null;
    await page.route("**/api/kody/guided-flows**", async (route) => {
      if (route.request().method() === "GET") return json(route, { flows: [] });
      startedFlow = route.request().postDataJSON() as {
        flowId?: string;
        instanceKey?: string;
      };
      return json(route, {
        instance: { status: "active" },
        flow: { id: "create-blueprint" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "create-blueprint-introduction",
          rendererSlug: "approval-card",
          rendererName: "Approval card",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "create-blueprint-instance",
            stepId: "introduction",
            revision: 0,
          },
          ui: {
            type: "stack",
            children: [
              {
                type: "text",
                value: "Create Blueprint",
                variant: "title",
              },
              {
                type: "button",
                label: "Begin",
                action: {
                  id: "continue",
                  label: "Begin",
                  response: "continue",
                  variant: "primary",
                },
              },
            ],
          },
          data: {},
        },
      });
    });

    await openStoreSolutions(page);
    await page.getByRole("button", { name: "Create Blueprint" }).click();

    await expect.poll(() => startedFlow).toMatchObject({
      flowId: "create-blueprint",
      instanceKey: "request-blueprint:create-blueprint",
    });
    await expect(
      page.getByRole("heading", { name: "Create Blueprint" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });

  test("applies a Blueprint in one action and hands it to Agency", async ({
    page,
  }) => {
    await mockStoreCatalog(page);
    let engineInstalled = false;
    let requestBody: unknown = null;
    let startedSlug: string | null = null;
    await page.route("**/api/kody/engine/install", async (route) => {
      engineInstalled = true;
      await json(route, { ok: true });
    });
    await page.route("**/api/kody/agency-requests", async (route) => {
      requestBody = route.request().postDataJSON();
      await json(route, {
        created: true,
        todoSlug: "build-healthy-ci",
        handoff: {
          displayContent: "Applying Blueprint to this repository.",
          message: "Apply the authorized Healthy CI Blueprint now.",
        },
      }, 201);
    });
    await page.route("**/api/kody/agency-requests/*/run", async (route) => {
      startedSlug = new URL(route.request().url()).pathname.split("/").at(-2) ?? null;
      await json(route, { kind: "started", runId: "run-1" }, 202);
    });

    await openStoreCatalog(page);
    await page.goto("/store-catalog/blueprint/healthy-ci", {
      waitUntil: "domcontentloaded",
    });
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Healthy CI" }),
    ).toBeVisible();
    await expect(dialog.getByText("Repository CI passes")).toBeVisible();
    await page
      .getByTestId("store-catalog-import-blueprint-healthy-ci")
      .click();

    await expect.poll(() => engineInstalled).toBe(true);
    await expect.poll(() => requestBody).not.toBeNull();
    await expect.poll(() => startedSlug).toBe("build-healthy-ci");
    await expect(page).toHaveURL(/\/todos\/build-healthy-ci$/);
    expect(requestBody).toMatchObject({
      blueprintId: "healthy-ci",
      source: {
        kind: "store-blueprint",
        blueprintId: "healthy-ci",
      },
      answers: {},
    });
  });

  test("keeps Solutions inside Catalog with full dependency details", async ({
    page,
  }) => {
    const imports = await mockStoreCatalog(page);
    await openStoreSolutions(page);

    await page.getByTestId("store-solution-row-web-release").click();
    await expect(page).toHaveURL(/\/store-catalog\/solution\/web-release$/);

    await expect(
      page.getByRole("heading", { name: "Web Release" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Complete setup", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Daily Web Release Loop")).toBeVisible();
    await expect(page.getByText("Release Prepare")).toBeVisible();

    await page.getByTestId("store-catalog-import-solution-web-release").click();
    expect(imports).toContainEqual({ kind: "solution", slug: "web-release" });
  });

  test("keeps Solutions out of the All components view", async ({ page }) => {
    await mockStoreCatalog(page);
    await openStoreCatalog(page);

    await expect(
      page.getByTestId("store-solution-row-web-release"),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  });

  test("opens component browsing from the Store homepage", async ({ page }) => {
    await mockStoreCatalog(page);
    await openStoreSolutions(page);

    await page.getByRole("button", { name: "Browse components" }).click();

    await expect(page).toHaveURL(/\/store-catalog\?filter=all$/);
    await expect(
      page.getByRole("heading", { name: "Browse components" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "Back to Solutions" }),
    ).toBeVisible();
  });

  test("keeps a non-All filter selected from an item route", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Desktop layout keeps the catalog list visible beside item detail.",
    );

    await mockStoreCatalog(page);
    await openStoreCatalog(page);
    await page.goto("/store-catalog/agent/atlas-agent", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByTestId("store-catalog-import-agent-atlas-agent"),
    ).toContainText("Install");
    await closeCatalogModal(page);

    const capabilitiesTab = page.getByRole("tab", { name: "Capabilities" });
    await capabilitiesTab.click();

    await expect(capabilitiesTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId("store-catalog-row-capability-release-watch"),
    ).toBeVisible();
    await expect(
      page.getByTestId("store-catalog-row-agent-atlas-agent"),
    ).toHaveCount(0);
  });

  test("opens item details in a modal from a card", async ({ page }) => {
    await mockStoreCatalog(page);
    await openStoreCatalog(page);

    await page.getByTestId("store-catalog-row-agent-atlas-agent").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Atlas Agent" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("store-catalog-import-agent-atlas-agent"),
    ).toContainText("Install");
  });

  test("shows selected item data in the modal", async ({ page }) => {
    await mockStoreCatalog(page);
    await openStoreCatalog(page);

    await page.getByTestId("store-catalog-row-workflow-bug-flow").click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Bug Flow" }),
    ).toBeVisible();
    await expect(dialog.getByText("Summary")).toBeVisible();
    await expect(
      dialog.getByText(
        "Reproduces, plans, implements, reviews, and fixes feedback.",
      ),
    ).toBeVisible();
  });

  test("shows workflow items under the Workflows filter", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Desktop layout keeps the catalog list visible beside item detail.",
    );

    await mockStoreCatalog(page);
    await openStoreCatalog(page);

    const workflowsTab = page.getByRole("tab", { name: "Workflows" });
    await workflowsTab.click();

    await expect(workflowsTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId("store-catalog-row-workflow-bug-flow"),
    ).toBeVisible();
    await expect(
      page.getByTestId("store-catalog-row-capability-release-watch"),
    ).toHaveCount(0);

    const capabilitiesTab = page.getByRole("tab", { name: "Capabilities" });
    await capabilitiesTab.click();
    await expect(
      page.getByTestId("store-catalog-row-capability-release-watch"),
    ).toBeVisible();
    await expect(
      page.getByTestId("store-catalog-row-workflow-bug-flow"),
    ).toHaveCount(0);
  });

  test("adds every agentic store item type by reference", async ({ page }) => {
    const imports = await mockStoreCatalog(page);

    await openStoreCatalog(page);

    for (const item of catalogSeeds.filter(
      (candidate) => candidate.kind !== "blueprint",
    )) {
      await addCatalogItem(page, item);
    }

    expect(imports).toEqual([
      { kind: "agent", slug: "atlas-agent" },
      { kind: "capability", slug: "release-watch" },
      { kind: "workflow", slug: "bug-flow" },
      { kind: "loop", slug: "daily-triage" },
      { kind: "trigger", slug: "ci-repair-on-ci-failure" },
      { kind: "workflow", slug: "release-workflow" },
      { kind: "command", slug: "factory" },
    ]);
  });

  test("uninstalls an active store item from its detail page", async ({
    page,
  }) => {
    const requests = await mockStoreCatalogWithInstallState(page);

    await openStoreCatalog(page);
    await page.goto("/store-catalog/command/factory", {
      waitUntil: "domcontentloaded",
    });

    const button = page.getByTestId("store-catalog-import-command-factory");
    await expect(button).toContainText("Uninstall");
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/kody/store-catalog/import") &&
          response.request().method() === "DELETE" &&
          response.status() === 200,
      ),
      button.click(),
    ]);
    await expect(button).toContainText("Install");
    expect(requests).toContainEqual({
      method: "DELETE",
      kind: "command",
      slug: "factory",
    });
  });

  test("blocks uninstall when an installed item is still referenced", async ({
    page,
  }) => {
    await mockStoreCatalogWithInstallState(page);

    await openStoreCatalog(page);
    await page.goto("/store-catalog/capability/release-watch", {
      waitUntil: "domcontentloaded",
    });

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Required by")).toBeVisible();
    await expect(dialog.getByText("Release Workflow")).toBeVisible();
    const button = page.getByTestId(
      "store-catalog-import-capability-release-watch",
    );
    await expect(button).toContainText("Uninstall");
    await expect(button).toBeDisabled();
  });
});
