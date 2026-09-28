/**
 * @fileoverview CMS adapter selection browser flow.
 * @testFramework playwright
 * @domain e2e
 */

import { expect, test, type Page } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

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

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
  await mockDashboardShellRequests(page);
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

async function mockAdapters(page: Page): Promise<void> {
  await page.route("**/api/kody/cms/adapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        adapters: [
          {
            name: "mongodb",
            label: "MongoDB",
            description: "MongoDB collections",
            supportsSchemaGeneration: true,
            htmlUrl: null,
          },
          {
            name: "github",
            label: "GitHub JSON",
            description: "GitHub JSON documents",
            supportsSchemaGeneration: false,
            htmlUrl: null,
          },
        ],
      }),
    });
  });
}

test.describe("CMS adapter setup", () => {
  test("assigns a new model to one of multiple connections", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium");
    let savedConnection: string | null = null;

    await seedAuth(page);
    await mockIdentity(page);
    await page.route("**/api/kody/cms", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cms: {
            configured: true,
            version: 1,
            name: "widgets CMS",
            environment: "default",
            defaultAdapter: "primary-db",
            adapters: {
              "primary-db": { adapter: "mongodb" },
              "archive-db": { adapter: "mongodb" },
            },
            writePolicy: "enabled",
            permissions: {},
            collections: [],
          },
        }),
      }),
    );
    await page.route("**/api/kody/cms/model", async (route) => {
      savedConnection = route.request().postDataJSON().collection.adapter;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cms: {
            configured: true,
            version: 1,
            name: "widgets CMS",
            environment: "default",
            defaultAdapter: "primary-db",
            adapters: {
              "primary-db": { adapter: "mongodb" },
              "archive-db": { adapter: "mongodb" },
            },
            writePolicy: "enabled",
            permissions: {},
            collections: [],
          },
        }),
      });
    });

    await page.goto("/content/models", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("products").first().fill("articles");
    await page.getByRole("combobox", { name: "Connection" }).click();
    await page.getByRole("option", { name: "archive-db" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => savedConnection).toBe("archive-db");
  });

  test("renders documents for the selected content collection", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop flow is enough for the content entries contract.",
    );

    let requestedPath: string | null = null;

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    await page.route("**/api/kody/cms", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cms: {
            configured: true,
            version: 1,
            name: "widgets CMS",
            environment: "default",
            defaultAdapter: "mongodb",
            writePolicy: "read-only",
            permissions: {},
            adapters: {
              mongodb: { databaseUriSecret: "DATABASE_URL" },
              "archive-db": {
                adapter: "mongodb",
                databaseUriSecret: "ARCHIVE_DATABASE_URL",
              },
            },
            collections: [
              {
                name: "lessons",
                label: "Lessons",
                adapter: "mongodb",
                writePolicy: "read-only",
                source: { collection: "lessons", idField: "_id" },
                operations: {
                  list: true,
                  get: true,
                  search: true,
                  create: false,
                  update: false,
                  delete: false,
                },
                searchFields: [],
                defaultSort: [],
                fields: [
                  { name: "_id", type: "id", label: "ID" },
                  { name: "title", type: "text", label: "Title" },
                ],
                filters: [],
                views: {
                  list: {
                    fields: [{ name: "title" }],
                    pageSize: 25,
                  },
                },
              },
              {
                name: "articles",
                label: "Articles",
                adapter: "archive-db",
                writePolicy: "read-only",
                source: { collection: "articles", idField: "_id" },
                operations: {
                  list: true,
                  get: true,
                  search: true,
                  create: false,
                  update: false,
                  delete: false,
                },
                searchFields: [],
                defaultSort: [],
                fields: [
                  { name: "_id", type: "id", label: "ID" },
                  { name: "title", type: "text", label: "Title" },
                ],
                filters: [],
              },
            ],
          },
        }),
      });
    });
    await page.route("**/api/kody/cms/lessons?**", async (route) => {
      requestedPath = new URL(route.request().url()).pathname;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          docs: [{ _id: "lesson-1", title: "Intro lesson" }],
          total: 1,
          limit: 25,
          offset: 0,
        }),
      });
    });

    await page.goto("/content/entries/lessons", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Intro lesson")).toBeVisible();
    await expect(page.getByText("No items")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Database" }).click();
    await page.getByRole("option", { name: "archive-db" }).click();
    const collectionsRail = page.getByRole("complementary", {
      name: "Content collections",
    });
    await expect(
      collectionsRail.getByRole("button", { name: /Articles/ }),
    ).toBeVisible();
    await expect(
      collectionsRail.getByRole("button", { name: /Lessons/ }),
    ).toHaveCount(0);
    expect(requestedPath).toBe("/api/kody/cms/lessons");
  });

  test("scopes schema generation and permissions to the selected database", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium");
    let schemaBody: Record<string, unknown> | null = null;
    let permissionsBody: Record<string, unknown> | null = null;

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    const cms = {
      configured: true,
      version: 1,
      name: "widgets CMS",
      environment: "default",
      defaultAdapter: "primary-db",
      adapters: {
        "primary-db": {
          adapter: "mongodb",
          databaseUriSecret: "PRIMARY_DATABASE_URL",
        },
        "archive-db": {
          adapter: "mongodb",
          databaseUriSecret: "ARCHIVE_DATABASE_URL",
        },
      },
      writePolicy: "enabled",
      permissions: {},
      collections: [
        {
          name: "products",
          label: "Products",
          adapter: "primary-db",
          writePolicy: "enabled",
          source: { collection: "products", idField: "_id" },
          operations: {
            list: true,
            get: true,
            search: true,
            create: true,
            update: true,
            delete: true,
          },
          searchFields: [],
          defaultSort: [],
          fields: [],
          filters: [],
        },
        {
          name: "archives",
          label: "Archives",
          adapter: "archive-db",
          writePolicy: "enabled",
          source: { collection: "archives", idField: "_id" },
          operations: {
            list: true,
            get: true,
            search: true,
            create: true,
            update: true,
            delete: true,
          },
          searchFields: [],
          defaultSort: [],
          fields: [],
          filters: [],
        },
      ],
    };
    await page.route("**/api/kody/cms/schema", async (route) => {
      schemaBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cms }),
      });
    });
    await page.route("**/api/kody/cms", async (route) => {
      if (route.request().method() === "PATCH")
        permissionsBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cms }),
      });
    });

    await page.goto("/content/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("combobox", { name: "Database" }).click();
    await page.getByRole("option", { name: "archive-db" }).click();
    await expect(page.getByText("ARCHIVE_DATABASE_URL")).toBeVisible();
    await page.getByRole("button", { name: "Update schema" }).click();
    await expect(page.getByRole("dialog")).toContainText("archive-db");
    await page.getByRole("button", { name: "Update schema" }).last().click();
    await expect.poll(() => schemaBody?.connectionName).toBe("archive-db");

    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByRole("dialog")).toContainText("archive-db");
    await expect(page.getByRole("dialog")).toContainText("Archives");
    await expect(page.getByRole("dialog")).not.toContainText("Products");
    await page.getByRole("button", { name: "Save permissions" }).click();
    await expect.poll(() => permissionsBody?.connectionName).toBe("archive-db");
    await expect
      .poll(
        () =>
          (permissionsBody?.collections as Array<{ name: string }>)[0]?.name,
      )
      .toBe("archives");
  });

  test("creates CMS config with the selected Store adapter", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop flow is enough for the adapter selector contract.",
    );

    let createdBody: { adapter?: string } | null = null;

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    await page.route("**/api/kody/cms", async (route) => {
      if (route.request().method() === "POST") {
        createdBody = route.request().postDataJSON() as { adapter?: string };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            cms: {
              configured: true,
              version: 1,
              name: "widgets CMS",
              environment: "default",
              defaultAdapter: createdBody.adapter,
              writePolicy: "read-only",
              permissions: {},
              collections: [],
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cms: { configured: false, collections: [] } }),
      });
    });

    await page.goto("/content/entries", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("combobox", { name: "Content adapter" }).click();
    await page.getByRole("option", { name: "GitHub JSON" }).click();
    await page.getByRole("button", { name: "Create content config" }).click();

    await expect.poll(() => createdBody?.adapter).toBe("github");
  });

  test("switches adapter after CMS is already configured", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop flow is enough for the adapter selector contract.",
    );

    let patchedBody: { adapter?: string; connectionName?: string } | null =
      null;
    let activeAdapter = "mongodb";

    await seedAuth(page);
    await mockIdentity(page);
    await mockAdapters(page);
    await page.route("**/api/kody/cms", async (route) => {
      if (route.request().method() === "PATCH") {
        patchedBody = route.request().postDataJSON() as {
          adapter?: string;
          connectionName?: string;
        };
        activeAdapter = patchedBody.adapter ?? activeAdapter;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cms: {
            configured: true,
            version: 1,
            name: "widgets CMS",
            environment: "default",
            defaultAdapter: activeAdapter,
            writePolicy: "read-only",
            permissions: {},
            collections: [],
          },
        }),
      });
    });

    await page.goto("/content/settings", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Content Settings" }),
    ).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Add connection" }).click();
    await page
      .getByRole("textbox", { name: "Connection name" })
      .fill("website-content");
    await page.getByRole("combobox", { name: "Source type" }).click();
    await page.getByRole("option", { name: "GitHub JSON" }).click();
    await page.getByRole("button", { name: "Save connection" }).click();

    await expect.poll(() => patchedBody?.adapter).toBe("github");
    await expect
      .poll(() => patchedBody?.connectionName)
      .toBe("website-content");
  });
});
