/**
 * @fileoverview Browser-level repro for Kody chat renderer output.
 * @testFramework playwright
 * @domain e2e-mocked
 *
 * The route is mocked, but the chat rail, SSE parser, rendered-view UI,
 * click handling, and one-click lock all run in the browser.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const LOCAL_BASE_URL =
  process.env.RENDERER_E2E_BASE_URL ??
  process.env.BASE_URL ??
  "http://127.0.0.1:3333";
// This is a mocked browser-contract suite. Keep its repository identity
// hermetic so a developer's live E2E environment cannot select a persisted
// runner or conversation and disable the fixture composer.
const TEST_TOKEN = "ghp_placeholder";
const TEST_REPO = "https://github.com/test-owner/test-repo";

function parseRepo(url: string): { owner: string; repo: string } {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    return { owner: parts[0] ?? "test-owner", repo: parts[1] ?? "test-repo" };
  } catch {
    return { owner: "test-owner", repo: "test-repo" };
  }
}

async function injectAuth(
  page: Page,
  options: { defaultChatEntry?: string | null } = {},
): Promise<void> {
  const { owner, repo } = parseRepo(TEST_REPO);
  await page.addInitScript(
    ({ auth, owner, repo, defaultChatEntry }) => {
      const repoKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      if (defaultChatEntry) {
        localStorage.setItem(
          `kody-default-chat-entry:${repoKey}`,
          defaultChatEntry,
        );
      } else {
        localStorage.removeItem(`kody-default-chat-entry:${repoKey}`);
      }
      localStorage.removeItem(`kody-sessions-v3:${repoKey}`);
      localStorage.removeItem("kody-sessions-v3");
    },
    {
      owner,
      repo,
      defaultChatEntry: Object.prototype.hasOwnProperty.call(
        options,
        "defaultChatEntry",
      )
        ? options.defaultChatEntry
        : "kody:chat-model-pro",
      auth: {
        repoUrl: TEST_REPO,
        owner,
        repo,
        token: TEST_TOKEN,
        user: { login: "renderer-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      },
    },
  );
}

function chatRail(page: Page) {
  return page.locator('[aria-label="Kody chat"]');
}

function chatInput(page: Page) {
  return chatRail(page).locator("textarea").first();
}

function sseBody(events: unknown[]): string {
  // A healthy AI SDK UI stream ends with `finish` + `[DONE]`; the transport
  // treats an EOF without them as a dropped connection (kody-direct.ts).
  const withTerminal = [...events, { type: "finish" }];
  return (
    withTerminal.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

async function mockShellApis(page: Page): Promise<void> {
  await mockDashboardShellRequests(page);
  await page.route("**/api/kody/chat/conversations**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isCollection = pathname.endsWith("/conversations");
    if (request.method() === "GET" && isCollection) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: [] }),
      });
      return;
    }
    await route.fulfill({
      status: request.method() === "POST" && isCollection ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        request.method() === "GET"
          ? {
              conversation: null,
              entries: [],
              checkpoints: [],
              runtimeBindings: [],
              attachments: [],
            }
          : { ok: true },
      ),
    });
  });
  await page.route("**/api/kody/tasks*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tasks: [] }),
    }),
  );
  await page.route("**/api/kody/config*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ config: { defaultPreviewUrl: "" } }),
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "chat-model-pro",
            provider: "example",
            modelName: "chat-model-pro",
            label: "Chat Model Pro",
            apiKeySecret: "MY_API_KEY",
            baseURL: "https://api.example.com/v1/",
            protocol: "openai",
            enabled: true,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/chat/global*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    }),
  );
  await page.route("**/api/kody/chat/global", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    }),
  );
}

function renderedApprovalView(
  overrides: {
    title?: string;
    body?: string;
    bodyType?: "text" | "markdown";
  } = {},
) {
  const title = overrides.title ?? "Confirm this question?";
  const body = overrides.body ?? "Should I continue?";
  const bodyType = overrides.bodyType ?? "text";
  return {
    action: "render_view",
    view: "renderer",
    id: "view-approval-e2e",
    rendererSlug: "decision-fixture",
    rendererName: "Decision",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: title, variant: "title" },
        { type: bodyType, value: body },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Approve",
              action: {
                id: "approve",
                label: "Approve",
                response: "approve",
                variant: "primary",
              },
            },
            {
              type: "button",
              label: "Cancel",
              action: { id: "cancel", label: "Cancel", response: "cancel" },
            },
          ],
        },
      ],
    },
    data: {
      title,
      body,
      actions: [
        {
          id: "approve",
          label: "Approve",
          response: "approve",
          variant: "primary",
        },
        { id: "cancel", label: "Cancel", response: "cancel" },
      ],
    },
  };
}

function renderedModelOutputRecoveryView() {
  const actions = [
    {
      id: "retry",
      label: "Retry same model",
      response: "Retry my last request with the same model.",
      variant: "primary",
    },
    {
      id: "choose-model",
      label: "Choose another model",
      response: "Choose another model.",
      variant: "secondary",
    },
    {
      id: "cancel",
      label: "Cancel",
      response: "Cancel this request.",
      variant: "secondary",
    },
  ];
  return {
    action: "render_view",
    view: "renderer",
    id: "model-output-recovery-1",
    rendererSlug: "model-output-recovery",
    rendererName: "Model output recovery",
    resultTarget: "chat",
    data: { title: "Model could not complete", actions },
    ui: {
      type: "stack",
      children: [
        { type: "text", variant: "title", value: "Model could not complete" },
        {
          type: "row",
          children: actions.map((action) => ({
            type: "button",
            label: action.label,
            action,
          })),
        },
      ],
    },
  };
}

function renderedSelectionView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-selection-e2e",
    rendererSlug: "choice-fixture",
    rendererName: "Choice",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Choose a report", variant: "title" },
        { type: "text", value: "Pick one report to open." },
        {
          type: "list",
          children: [
            {
              type: "button",
              label: "CTO Report",
              action: { id: "cto", label: "CTO Report", response: "cto" },
            },
            {
              type: "button",
              label: "Kody Health Check",
              action: {
                id: "health",
                label: "Kody Health Check",
                response: "health",
              },
            },
          ],
        },
      ],
    },
    data: {
      title: "Choose a report",
      body: "Pick one report to open.",
      items: [
        { id: "cto", label: "CTO Report", response: "cto" },
        { id: "health", label: "Kody Health Check", response: "health" },
      ],
    },
  };
}

function renderedWorkflowListView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-workflow-list-e2e",
    rendererSlug: "workflow-list-fixture",
    rendererName: "Workflow list",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Agency workflows", variant: "title" },
        {
          type: "list",
          children: [
            { type: "text", value: "Release review" },
            { type: "text", value: "Repository health check" },
          ],
        },
      ],
    },
    data: {
      workflows: ["Release review", "Repository health check"],
    },
  };
}

function renderedMultiSelectionView() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-multi-selection-e2e",
    rendererSlug: "bulk-choice-fixture",
    rendererName: "Bulk choice",
    resultTarget: "chat",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Choose reports", variant: "title" },
        { type: "text", value: "Pick every report to open." },
        {
          type: "list",
          children: [
            {
              type: "checkbox",
              name: "selected",
              value: "cto",
              label: "CTO Report",
            },
            {
              type: "checkbox",
              name: "selected",
              value: "health",
              label: "Kody Health Check",
            },
            {
              type: "checkbox",
              name: "selected",
              value: "security",
              label: "Security Audit",
            },
          ],
        },
        { type: "submit", label: "Confirm reports" },
      ],
    },
    data: {
      title: "Choose reports",
      body: "Pick every report to open.",
      items: [
        { id: "cto", label: "CTO Report", response: "cto" },
        { id: "health", label: "Kody Health Check", response: "health" },
        { id: "security", label: "Security Audit", response: "security" },
      ],
    },
  };
}

function renderedProjectAssessmentForm() {
  return {
    action: "render_view",
    view: "renderer",
    id: "view-project-assessment-e2e",
    rendererSlug: "approval-card",
    rendererName: "Approval card",
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: "assessment-from-chat",
      stepId: "introduction",
      revision: 0,
    },
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Deep project assessment", variant: "title" },
        {
          type: "markdown",
          value:
            "Kody automatically inspects repository evidence. You answer seven questions, each answer is saved, and assessment work starts only after the final answer.",
        },
        {
          type: "list",
          children: [
            {
              type: "button",
              label: "Begin questions",
              action: {
                id: "continue",
                label: "Begin questions",
                response: "continue",
                variant: "primary",
              },
            },
          ],
        },
      ],
    },
    data: {},
  };
}

async function mockChatStream(
  page: Page,
  options: {
    onRequest?: (body: { messages?: Array<{ content?: string }> }) => void;
  } = {},
): Promise<void> {
  let turn = 0;
  await page.route("**/api/kody/chat/kody", async (route: Route) => {
    turn += 1;
    const body = route.request().postDataJSON() as {
      messages?: Array<{ content?: string }>;
    };
    options.onRequest?.(body);
    const latest = body.messages?.at(-1)?.content ?? "";
    const output = latest.includes("project assessment")
      ? renderedProjectAssessmentForm()
      : latest.includes("agency workflows")
        ? renderedWorkflowListView()
        : latest.includes("multiple") && latest.includes("reports")
          ? renderedMultiSelectionView()
          : latest.includes("reports") && latest.includes("select")
            ? renderedSelectionView()
            : turn === 1
              ? renderedApprovalView()
              : { content: "Recorded." };
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: sseBody([
        {
          type: "tool-input-available",
          toolCallId: `tool-${turn}`,
          toolName: output && "action" in output ? "show_view" : "final_answer",
          input:
            output && "action" in output
              ? { purpose: "fixture", data: { title: "Fixture" } }
              : output,
        },
        {
          type: "tool-output-available",
          toolCallId: `tool-${turn}`,
          output,
        },
      ]),
    });
  });
}

async function mockRecoveryChatStream(
  page: Page,
  onRequest?: (body: { model?: string }) => void,
): Promise<void> {
  let turn = 0;
  await page.route("**/api/kody/chat/kody", async (route: Route) => {
    turn += 1;
    const body = route.request().postDataJSON() as { model?: string };
    onRequest?.(body);
    const output =
      turn === 1
        ? renderedModelOutputRecoveryView()
        : { content: "Retried with the selected model." };
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: sseBody([
        {
          type: "tool-input-available",
          toolCallId: `tool-recovery-${turn}`,
          toolName: turn === 1 ? "show_view" : "final_answer",
          input: turn === 1 ? { purpose: "model-output-recovery" } : output,
        },
        {
          type: "tool-output-available",
          toolCallId: `tool-recovery-${turn}`,
          output,
        },
      ]),
    });
  });
}

async function openChat(
  page: Page,
  options: { defaultChatEntry?: string | null } = {},
): Promise<void> {
  await injectAuth(page, options);
  await page.goto(`${LOCAL_BASE_URL}/repo/test-owner/test-repo`);
  await page.waitForLoadState("domcontentloaded");

  const viewport = await page.viewportSize();
  test.skip((viewport?.width ?? 1280) < 768, "chat rail hidden on mobile");

  await expect(chatInput(page)).toBeEditable({ timeout: 10_000 });
}

async function sendChatMessage(page: Page, text: string): Promise<void> {
  await chatInput(page).fill(text);
  await chatRail(page).getByRole("button", { name: "Send message" }).click();
}

test.describe("Kody chat renderer output", () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page);
    await mockChatStream(page);
  });

  test("new repository conversation opens with useful starting actions", async ({
    page,
  }) => {
    let guidedFlowRequestUrl = "";
    let chatRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/kody/chat/kody")) chatRequests += 1;
    });
    await page.route("**/api/kody/guided-flows**", async (route) => {
      guidedFlowRequestUrl = route.request().url();
      const request = route.request();
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      if (body?.action === "start" && body?.flowId === "project-assessment") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            instance: {
              instanceId: "assessment-flow",
              revision: 0,
              status: "active",
              data: {},
            },
            flow: {
              id: "project-assessment",
              title: "Project assessment",
              stepIndex: 0,
              stepCount: 8,
            },
            compatibility: { status: "compatible" },
            view: {
              action: "render_view",
              view: "renderer",
              id: "guided-flow-assessment-flow-0",
              rendererSlug: "approval-card",
              rendererName: "Approval card",
              resultTarget: "guided-flow",
              guidedFlow: {
                instanceId: "assessment-flow",
                stepId: "introduction",
                revision: 0,
              },
              ui: {
                type: "stack",
                children: [
                  {
                    type: "text",
                    value: "Deep project assessment",
                    variant: "title",
                  },
                  {
                    type: "markdown",
                    value:
                      "Kody automatically inspects the repository and GitHub history. You answer seven questions, each answer is saved, and assessment work starts only after the final answer.",
                  },
                  {
                    type: "list",
                    children: [
                      {
                        type: "stack",
                        children: [
                          {
                            type: "button",
                            label: "Begin questions",
                            action: {
                              id: "continue",
                              label: "Begin questions",
                              response: "continue",
                              variant: "primary",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              data: {},
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          flows: [
            {
              instance: {
                instanceId: "active-flow",
                revision: 1,
                status: "active",
              },
              flow: {
                title: "Get started with Kody",
                stepIndex: 2,
                stepCount: 5,
              },
              compatibility: { status: "compatible" },
            },
            {
              instance: {
                instanceId: "unavailable-flow",
                revision: 1,
                status: "active",
              },
              flow: {
                title: "Unavailable setup",
                stepIndex: 0,
                stepCount: 2,
              },
              compatibility: {
                status: "incompatible",
                code: "renderer_unavailable",
                message: "Renderer unavailable",
              },
            },
          ],
        }),
      });
    });
    await openChat(page);
    await expect(page.getByText("Hi! I can help you with:")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run project assessment" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Run project assessment" }).click();
    await expect(page.getByText("Deep project assessment")).toBeVisible();
    await expect(
      page.getByText(/answer seven questions/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Begin questions" }),
    ).toBeVisible();
    await expect(
      page.getByText("Business importance and acceptable failures"),
    ).toHaveCount(0);
    expect(chatRequests).toBe(0);

    await page.getByRole("button", { name: "New conversation" }).click();
    await expect.poll(() => guidedFlowRequestUrl).toContain("status=active");
    await expect(
      page.getByText("You have an unfinished GuidedFlow."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume flow" }),
    ).toBeEnabled();
    await expect(page.getByText("Unavailable setup")).toHaveCount(0);
    await expect(page.getByText("Start with this repository.")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Run project assessment" }),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Resume flow" })).toHaveClass(
      /cursor-pointer/,
    );
  });

  test("approval request renders a card and locks after one click", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText("Confirm this question?")).toBeVisible();
    await expect(page.getByText("Should I continue?")).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve" });
    await expect(approve).toBeVisible();

    await approve.click();
    await expect(approve).toBeDisabled();
  });

  test("typed project assessment request opens the same first flow step", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "Run a complete project assessment");

    await expect(page.getByText("Deep project assessment")).toBeVisible();
    await expect(
      page.getByText(/answer seven questions/i),
    ).toBeVisible();
    await expect(
      page.getByText("Business importance and acceptable failures"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Begin questions" }),
    ).toBeVisible();
  });

  test("rejected final-answer approval prose does not leak before renderer", async ({
    page,
  }) => {
    const leakedQuestion =
      "Also, before I open it — the dashboard Changelog page reads from the repo's CHANGELOG.md. Want me to peek at that file to see what it's actually serving right now, so the issue points to the real cause?";
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          },
          {
            type: "text-delta",
            delta: leakedQuestion,
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-final-answer",
            toolName: "final_answer",
            input: { content: leakedQuestion },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-final-answer",
            output: {
              error:
                "final_answer requires show_view for this interactive response",
            },
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-show-view",
            toolName: "show_view",
            input: {
              purpose: "approval-card",
              data: { title: "Peek at CHANGELOG.md first?" },
            },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-show-view",
            output: renderedApprovalView({
              title: "Peek at CHANGELOG.md first?",
              body: "This will make the issue point to the real cause.",
            }),
          },
        ]),
      });
    });
    await openChat(page);

    await sendChatMessage(page, "open a bug for the changelog page");

    await expect(page.getByText("Peek at CHANGELOG.md first?")).toBeVisible();
    await expect(page.getByText(leakedQuestion)).toHaveCount(0);
  });

  test("keeps streamed answer text when a renderer follows it", async ({
    page,
  }) => {
    const committedText = "I found two safe ways to continue.";
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          },
          {
            type: "tool-input-start",
            toolCallId: "tool-final-before-view",
            toolName: "final_answer",
          },
          {
            type: "tool-input-delta",
            toolCallId: "tool-final-before-view",
            inputTextDelta: `{"content":"${committedText}"}`,
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-final-before-view",
            toolName: "final_answer",
            input: { content: committedText },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-final-before-view",
            output: { content: committedText },
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-view-after-text",
            toolName: "show_view",
            input: {
              purpose: "approval-card",
              data: { title: "Choose how to continue" },
            },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-view-after-text",
            output: renderedApprovalView({
              title: "Choose how to continue",
              body: "Select the next step.",
            }),
          },
        ]),
      });
    });
    await openChat(page);

    await sendChatMessage(page, "show the explanation and choices");

    await expect(page.getByText(committedText)).toBeVisible();
    await expect(page.getByText("Choose how to continue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  test("plain streamed text is rendered without client-side renderer guessing", async ({
    page,
  }) => {
    const plainQuestion = "Want me to file this as a bug now?";
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([{ type: "text-delta", delta: plainQuestion }]),
      });
    });
    await openChat(page);

    await sendChatMessage(
      page,
      "i want to open new issue, changelog is not properly being populated",
    );

    await expect(page.getByText(plainQuestion)).toBeVisible();
    await expect(page.getByText(/output tool/i)).toHaveCount(0);
  });

  test("approval markdown body renders as formatted content", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "tool-input-available",
            toolCallId: "tool-markdown-view",
            toolName: "show_view",
            input: {
              purpose: "approval-card",
              data: { title: "File this bug?" },
            },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-markdown-view",
            output: renderedApprovalView({
              title: "File this bug?",
              bodyType: "markdown",
              body: "**Title:** Changelog not populated\n\n**Steps to reproduce:**\n1. Open the Changelog page\n2. Scroll to the top\n\n**Expected:** Each release lists merged work.",
            }),
          },
        ]),
      });
    });
    await openChat(page);

    await sendChatMessage(page, "ask approval to file the changelog bug");

    await expect(page.getByText("File this bug?")).toBeVisible();
    await expect(page.getByText("Title:")).toBeVisible();
    await expect(page.getByText("Open the Changelog page")).toBeVisible();
    await expect(page.getByText("**Title:**")).toHaveCount(0);
  });

  test("report selection request renders a selectable list and locks after one click", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "list all reports allow me to select one");

    await expect(page.getByText("Choose a report")).toBeVisible();
    const cto = page.getByRole("button", { name: "CTO Report" });
    await expect(cto).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Kody Health Check" }),
    ).toBeVisible();

    await cto.click();
    await expect(cto).toBeDisabled();
  });

  test("agency workflow listing renders as a read-only list", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "list all agency workflows");

    await expect(
      page.getByRole("heading", { name: "Agency workflows" }),
    ).toBeVisible();
    await expect(page.getByText("Release review")).toBeVisible();
    await expect(page.getByText("Repository health check")).toBeVisible();
    await expect(
      chatRail(page).getByRole("button", { name: /release review/i }),
    ).toHaveCount(0);
  });

  test("multi-selection request uses checkbox and submit atoms then locks", async ({
    page,
  }) => {
    await openChat(page);

    await sendChatMessage(page, "let me select multiple reports");

    await expect(page.getByText("Choose reports")).toBeVisible();
    const cto = page.getByRole("checkbox", { name: "CTO Report" });
    const health = page.getByRole("checkbox", { name: "Kody Health Check" });
    const security = page.getByRole("checkbox", { name: "Security Audit" });
    const confirm = page.getByRole("button", { name: "Confirm reports" });

    await expect(cto).toBeVisible();
    await cto.click();
    await health.click();

    await expect(cto).toBeChecked();
    await expect(health).toBeChecked();
    await expect(security).not.toBeChecked();

    await confirm.click();

    await expect(confirm).toBeDisabled();
    await expect(cto).toBeDisabled();
    await expect(health).toBeDisabled();
  });

  test("multi-selection submit sends selected items, not only the submit label", async ({
    page,
  }) => {
    const sentMessages: string[] = [];
    await page.unroute("**/api/kody/chat/kody");
    await mockChatStream(page, {
      onRequest: (body) => {
        const latest = body.messages?.at(-1)?.content;
        if (latest) sentMessages.push(latest);
      },
    });
    await openChat(page);

    await sendChatMessage(page, "let me select multiple reports");

    const cto = page.getByRole("checkbox", { name: "CTO Report" });
    const health = page.getByRole("checkbox", { name: "Kody Health Check" });
    const confirm = page.getByRole("button", { name: "Confirm reports" });
    await cto.click();
    await health.click();
    await confirm.click();

    await expect(
      page.getByText("Selected: CTO Report (cto), Kody Health Check (health)"),
    ).toBeVisible();
    await expect(
      page.getByText("Confirm reports", { exact: true }),
    ).toHaveCount(1);
    await expect.poll(() => sentMessages.length).toBeGreaterThanOrEqual(2);
    expect(sentMessages.at(-1)).toContain("cto");
    expect(sentMessages.at(-1)).toContain("health");
    expect(sentMessages.at(-1)).not.toBe("Confirm reports");
  });

  test("approval request uses renderer-capable Kody path when a model exists without a saved default", async ({
    page,
  }) => {
    let directChatCalled = false;
    let liveChatCalled = false;
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      directChatCalled = true;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "tool-input-available",
            toolCallId: "tool-default-kody",
            toolName: "show_view",
            input: { purpose: "fixture", data: { title: "Fixture" } },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-default-kody",
            output: renderedApprovalView(),
          },
        ]),
      });
    });
    await page.route("**/api/kody/chat/interactive/start*", (route) => {
      liveChatCalled = true;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "live path should not handle renderer" }),
      });
    });

    await openChat(page, { defaultChatEntry: null });

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText("Confirm this question?")).toBeVisible();
    expect(directChatCalled).toBe(true);
    expect(liveChatCalled).toBe(false);
  });

  test("failed renderer tool output does not leave a blank assistant reply", async ({
    page,
  }) => {
    const unfinishedProse =
      "Let me just use show_view to ask you directly in-chat:";
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "text-delta",
            delta: unfinishedProse,
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-render-error",
            toolName: "show_view",
            input: { purpose: "approval-card", data: {} },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-render-error",
            output: { error: "show_view requires data" },
          },
        ]),
      });
    });

    await openChat(page);

    await sendChatMessage(
      page,
      "aske me a q and ask for approval to confirm it",
    );

    await expect(page.getByText(/show_view requires data/i)).toBeVisible();
    await expect(page.getByText(unfinishedProse)).toHaveCount(0);
  });

  test("a recovered renderer retry keeps the first validation error visible", async ({
    page,
  }) => {
    const validationError =
      "spec: elements: Invalid input: expected record, received array";
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "tool-input-available",
            toolCallId: "tool-render-invalid",
            toolName: "show_view",
            input: { root: "card", elements: [] },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-render-invalid",
            output: { error: validationError },
          },
          {
            type: "tool-input-available",
            toolCallId: "tool-render-retry",
            toolName: "show_view",
            input: { root: "card", elements: {} },
          },
          {
            type: "tool-output-available",
            toolCallId: "tool-render-retry",
            output: renderedApprovalView({ title: "Retry succeeded" }),
          },
        ]),
      });
    });

    await openChat(page);
    await sendChatMessage(page, "Ask me to approve this plan.");

    await expect(page.getByText("Retry succeeded")).toBeVisible();
    await chatRail(page).getByRole("button", { name: /Thought/ }).click();
    await page.getByRole("button", { name: "Show view" }).first().click();
    await expect(
      chatRail(page).locator("code").filter({ hasText: validationError }),
    ).toBeVisible();
  });

  test("recovery card keeps model choice under user control", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await mockRecoveryChatStream(page);

    await openChat(page);
    await sendChatMessage(page, "Ask me to approve this plan.");
    await page.getByRole("button", { name: "Choose another model" }).click();

    await expect(page.getByTestId("chat-setup-menu")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Model", expanded: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /Chat Model Pro/ }),
    ).toBeVisible();
  });

  test("retry recovery keeps the selected model", async ({ page }) => {
    const requestedModels: Array<string | undefined> = [];
    await page.unroute("**/api/kody/chat/kody");
    await mockRecoveryChatStream(page, (body) => {
      requestedModels.push(body.model);
    });

    await openChat(page);
    await sendChatMessage(page, "Ask me to approve this plan.");
    await page.getByRole("button", { name: "Retry same model" }).click();

    await expect(
      page.getByText("Retried with the selected model."),
    ).toBeVisible();
    expect(requestedModels).toEqual(["openrouter/free", "openrouter/free"]);
  });

  test("cancel recovery ends the interaction without another model request", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.unroute("**/api/kody/chat/kody");
    await mockRecoveryChatStream(page, () => {
      requestCount += 1;
    });

    await openChat(page);
    await sendChatMessage(page, "Ask me to approve this plan.");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(
      page.getByRole("button", { name: "Retry same model" }),
    ).toBeDisabled();
    expect(requestCount).toBe(1);
  });

  test("provider invoke markup does not leak into the visible chat", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "reasoning-delta",
            delta:
              'Looking now.\n<invoke name="github_list_tree">]<]minimax[>[<path>/src/app</path>]<]minimax[>[</invoke> ]<]minimax[>[',
          },
          {
            type: "text-delta",
            delta: "The login code is in /src/app.",
          },
        ]),
      });
    });

    await openChat(page);

    await sendChatMessage(page, "find the login code");

    await expect(
      page.getByText("The login code is in /src/app."),
    ).toBeVisible();
    await page.getByRole("button", { name: /thought/i }).click();
    await expect(page.getByText("Looking now.")).toBeVisible();
    await expect(
      chatRail(page).getByText(/invoke|github_list_tree|minimax|<path>/i),
    ).toHaveCount(0);
  });

  test("direct Kody shows copied reasoning only in the collapsed section", async ({
    page,
  }) => {
    const reasoning = [
      "The user is asking why the response is long.",
      "I need to inspect the direct chat stream.",
    ].join("\n\n");
    const copiedWithCollapsedWhitespace = reasoning.replace(/\s+/g, " ");

    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          { type: "reasoning-delta", delta: reasoning },
          {
            type: "text-delta",
            delta: `${copiedWithCollapsedWhitespace}\n\nFinal answer: The stream duplicated the thinking.`,
          },
        ]),
      });
    });

    await openChat(page);
    await sendChatMessage(page, "why is the answer duplicated?");

    await expect(
      page.getByText("The stream duplicated the thinking."),
    ).toBeVisible();
    await expect(page.getByText(copiedWithCollapsedWhitespace)).toHaveCount(0);

    await page.getByRole("button", { name: /thought/i }).click();
    await expect(
      page.getByText("The user is asking why the response is long."),
    ).toBeVisible();
    await expect(
      page.getByText("I need to inspect the direct chat stream."),
    ).toBeVisible();
  });

  test("exclusive chat output shows one committed answer across retries", async ({
    page,
  }) => {
    await page.unroute("**/api/kody/chat/kody");
    await page.route("**/api/kody/chat/kody", async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body: sseBody([
          {
            type: "data-chat-output-contract",
            data: { mode: "exclusive-tool" },
          },
          {
            type: "reasoning-delta",
            delta: "The user said hi. I should answer normally.",
          },
          { type: "text-delta", delta: "first draft" },
          {
            type: "reasoning-delta",
            delta: "The first attempt missed final_answer. Retrying.",
          },
          { type: "text-delta", delta: "second draft" },
          {
            type: "tool-input-available",
            toolCallId: "final-retry-answer",
            toolName: "final_answer",
            input: { content: "Hello! How can I help?" },
          },
          {
            type: "tool-output-available",
            toolCallId: "final-retry-answer",
            output: { content: "Hello! How can I help?" },
          },
        ]),
      });
    });

    await openChat(page);
    await sendChatMessage(page, "hi");

    await expect(page.getByText("Hello! How can I help?")).toBeVisible();
    await expect(page.getByText(/first draft|second draft/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /thought/i })).toHaveCount(0);
    await expect(
      page.getByText(/The user said hi|missed final_answer/i),
    ).toHaveCount(0);
  });
});
