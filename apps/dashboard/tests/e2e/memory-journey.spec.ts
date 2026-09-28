import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";
import type {
  Memory,
  MemoryRevision,
} from "../../src/dashboard/lib/api/memory";

const OWNER = "memory-e2e";
const REPO = "workspace";
const EXISTING_ID = "memory-existing";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function seedAuth(page: Page) {
  await page.addInitScript(
    ({ owner, repo }) => {
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "memory-token",
          user: { login: "memory-e2e", avatar_url: "", id: 1 },
          loggedInAt: Date.now(),
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );
}

async function showWorkspaceContent(page: Page, content: Locator) {
  if (!(await content.isVisible())) {
    const hideFilePanel = page.getByRole("button", {
      name: "Hide file panel",
    });
    if (await hideFilePanel.isVisible()) await hideFilePanel.click();
  }
  await expect(content).toBeVisible();
}

test("creates, revises, reviews, and deletes typed memory", async ({
  page,
}) => {
  const failures: string[] = [];
  const now = "2026-07-25T10:00:00.000Z";
  const memories: Memory[] = [
    {
      id: EXISTING_ID,
      scope: { kind: "repository", tenantId: `${OWNER}/${REPO}` },
      kind: "decision",
      content: {
        title: "Runtime owner",
        summary: "Convex owns runtime state.",
        body: "Do not use GitHub as a runtime fallback.",
      },
      currentRevisionId: "revision-existing",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const revisions = new Map<string, MemoryRevision[]>([
    [
      EXISTING_ID,
      [
        {
          id: "revision-existing",
          memoryId: EXISTING_ID,
          previousRevisionId: null,
          kind: "decision",
          content: memories[0].content,
          evidence: [{ source: "user-input", id: "request-1" }],
          reason: "Approved decision.",
          actor: { kind: "user", id: "github:1" },
          createdAt: now,
        },
      ],
    ],
  ]);

  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    ) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const isCancelledMachineProbe =
      url.pathname === "/api/kody/chat/machines" &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    const isCancelledRscNavigation =
      url.searchParams.has("_rsc") &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    if (!isCancelledMachineProbe && !isCancelledRscNavigation) {
      failures.push(`${request.method()} ${request.url()} failed`);
    }
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await seedAuth(page);
  await mockDashboardShellRequests(page);

  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "memory-e2e", avatar_url: "", githubId: 1 },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/memory**", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      const created: Memory = {
        id: "memory-created",
        scope:
          input.scope === "user"
            ? { kind: "user", userId: "github:1" }
            : { kind: "repository", tenantId: `${OWNER}/${REPO}` },
        kind: input.kind,
        content: {
          title: input.title,
          summary: input.summary,
          body: input.body,
        },
        currentRevisionId: "revision-created",
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      memories.push(created);
      revisions.set(created.id, [
        {
          id: "revision-created",
          memoryId: created.id,
          previousRevisionId: null,
          kind: created.kind,
          content: created.content,
          evidence: [{ source: "user-input", id: "request-2" }],
          reason: input.reason || "Created manually.",
          actor: { kind: "user", id: "github:1" },
          createdAt: now,
        },
      ]);
      return json(route, { memory: created }, 201);
    }
    return json(route, { memories });
  });
  await page.route("**/api/kody/memory/*", async (route) => {
    const id = decodeURIComponent(route.request().url().split("/").at(-1)!);
    const index = memories.findIndex((memory) => memory.id === id);
    if (index < 0) return json(route, { error: "not_found" }, 404);
    if (route.request().method() === "DELETE") {
      memories.splice(index, 1);
      revisions.delete(id);
      return json(route, { deleted: true });
    }
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      const current = memories[index];
      const updated = {
        ...current,
        kind: input.kind ?? current.kind,
        content: {
          title: input.title ?? current.content.title,
          summary: input.summary ?? current.content.summary,
          body: input.body ?? current.content.body,
        },
        currentRevisionId: "revision-updated",
        updatedAt: "2026-07-25T11:00:00.000Z",
      };
      memories[index] = updated;
      revisions.get(id)?.push({
        id: "revision-updated",
        memoryId: id,
        previousRevisionId: current.currentRevisionId,
        kind: updated.kind,
        content: updated.content,
        evidence: [{ source: "user-input", id: "request-3" }],
        reason: input.reason || "Updated manually.",
        actor: { kind: "user", id: "github:1" },
        createdAt: updated.updatedAt,
      });
      return json(route, { memory: updated });
    }
    return json(route, {
      memory: memories[index],
      revisions: revisions.get(id),
    });
  });
  await page.route("**/api/kody/agents", (route) => json(route, { agent: [] }));
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isCollection = pathname.endsWith("/conversations");
    return json(
      route,
      request.method() === "GET" && isCollection
        ? { conversations: [] }
        : request.method() === "GET"
          ? {
              conversation: null,
              entries: [],
              checkpoints: [],
              runtimeBindings: [],
              attachments: [],
            }
          : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [] }),
  );
  for (const path of [
    "commands",
    "system-events",
    "guided-flows",
  ]) {
    await page.route(`**/api/kody/${path}`, (route) => json(route, {}));
  }

  await page.goto(`/repo/${OWNER}/${REPO}/memory`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Memory" })).toBeVisible();

  await page.getByRole("treeitem", { name: /Repository/ }).click();
  const decisionFolders = page.getByRole("treeitem", {
    name: "Decision",
    exact: true,
  });
  await expect(decisionFolders).toHaveCount(1);
  await decisionFolders.click();
  await page.getByRole("treeitem", { name: /Runtime owner\.md/ }).click();
  const memoryHeading = page.getByRole("heading", { name: /^Runtime owner/ });
  await showWorkspaceContent(page, memoryHeading);
  await expect(page.getByText("Revision history")).toBeVisible();
  await expect(page.getByText("Approved decision.")).toBeVisible();

  await page.getByRole("button", { name: "Search memory" }).click();
  const searchDialog = page.getByRole("dialog", { name: "Search memory" });
  await searchDialog
    .getByRole("textbox", { name: "Search memory" })
    .fill("runtime state");
  await searchDialog
    .getByRole("button", { name: "Open Runtime owner" })
    .click();
  await showWorkspaceContent(page, memoryHeading);

  await page.getByRole("button", { name: "Edit memory" }).click();
  await page.getByLabel("Summary").fill("Convex alone owns runtime state.");
  await page.getByLabel("Reason").fill("Clarified the decision.");
  await page.getByRole("button", { name: "Save" }).click();
  const revisedSummary = page.locator("blockquote p").last();
  await showWorkspaceContent(page, revisedSummary);
  await expect(revisedSummary).toHaveText("Convex alone owns runtime state.");
  await expect(page.getByText("Clarified the decision.").last()).toBeVisible();

  await page.getByRole("button", { name: "New memory" }).click();
  await page.getByLabel("Title").fill("Reply style");
  await page.getByLabel("Summary").fill("Prefers short replies.");
  await page.getByLabel("Details").fill("Use simple words.");
  await page.getByLabel("Reason").fill("Explicit user preference.");
  await page.getByRole("button", { name: "Save" }).click();
  const createdHeading = page.getByRole("heading", { name: "Reply style" });
  await showWorkspaceContent(page, createdHeading);

  await page.getByRole("button", { name: "Delete memory" }).click();
  await expect(page).toHaveURL(/\/memory$/);
  await expect(page.getByText("Reply style")).toHaveCount(0);
  expect(failures).toEqual([]);
});
