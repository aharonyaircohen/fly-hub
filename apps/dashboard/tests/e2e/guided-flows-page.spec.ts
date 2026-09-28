import { expect, test, type Route } from "@playwright/test";
import { mockKodyAccountSession } from "./support/dashboard-shell-mocks";

const auth = {
  repoUrl: "https://github.com/acme/widgets",
  owner: "acme",
  repo: "widgets",
  token: "e2e-token",
  user: { login: "e2e-test", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (value) => window.localStorage.setItem("kody_auth", JSON.stringify(value)),
    auth,
  );
  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: { login: "e2e-test", avatar_url: "", githubId: 1 },
    }),
  );
  await mockKodyAccountSession(page);
});

test("starts a GuidedFlow in Chat and keeps its conversation binding when the user asks a question", async ({
  page,
}) => {
  let startedFlowId: string | null = null;
  let boundConversationId: string | null = null;
  let chatConversationId: string | null = null;
  let startOwnerHeader: string | null = null;
  let startRepoHeader: string | null = null;
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      request.method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Kody Test", enabled: true }],
    }),
  );
  await page.route("**/api/kody/chat/kody", (route) => {
    const body = route.request().postDataJSON() as {
      conversationId?: string;
    };
    chatConversationId = body.conversationId ?? null;
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        'data: {"type":"text-delta","delta":"You are on the confirmation step."}\n\n' +
        'data: {"type":"finish"}\n\n' +
        "data: [DONE]\n\n",
    });
  });
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        flowId?: string;
        conversationId?: string;
      };
      startedFlowId = body.flowId ?? null;
      boundConversationId = body.conversationId ?? null;
      startOwnerHeader = route.request().headers()["x-kody-owner"] ?? null;
      startRepoHeader = route.request().headers()["x-kody-repo"] ?? null;
      return json(route, {
        instance: { status: "active" },
        flow: {
          id: "addition-exercise",
          title: "Addition exercise",
          stepIndex: 0,
          stepCount: 2,
        },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "guided-flow-test-instance-0",
          rendererSlug: "approval-card",
          rendererName: "Approval card",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "test-instance",
            stepId: "confirm",
            revision: 0,
          },
          ui: {
            type: "stack",
            children: [
              {
                type: "text",
                value: "Test flow started in Chat",
                variant: "title",
              },
            ],
          },
          data: { title: "Test flow started in Chat" },
        },
      });
    }
    return json(route, {
      definitions: [
        {
          id: "custom-personal-flow",
          title: "Custom personal flow",
          source: "custom",
          steps: [{ rendererSlug: "guided-form" }],
        },
      ],
    });
  });
  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "Guided Flows" }),
  ).toBeVisible();
  await expect(
    page.getByText("Custom personal flow", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("In progress", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "History", exact: true }),
  ).toHaveCount(0);
  const startInChat = page.getByRole("button", {
    name: "Start Custom personal flow in Chat",
  });
  await expect(startInChat).toBeVisible();
  await startInChat.click();
  await expect.poll(() => startedFlowId).toBe("custom-personal-flow");
  await expect.poll(() => startOwnerHeader).toBeNull();
  await expect.poll(() => startRepoHeader).toBeNull();
  await expect.poll(() => boundConversationId).toBeTruthy();
  await expect(page).toHaveURL(/\/repo\/acme\/widgets\/chat\/.+/);
  await expect(page.getByText("Test flow started in Chat")).toBeVisible();

  const input = page.locator('[aria-label="Kody chat"] textarea').first();
  await expect(input).toBeEditable();
  await input.fill("Where am I in this lesson?");
  await page
    .locator('[aria-label="Kody chat"]')
    .getByRole("button", { name: "Send message" })
    .click();

  await expect(
    page.getByText("You are on the confirmation step."),
  ).toBeVisible();
  await expect.poll(() => chatConversationId).toBe(boundConversationId);
});

test("loads Guided Flow choices from the repository CMS", async ({ page }) => {
  let selectedCourseId: unknown = null;
  let cmsOwnerHeader: string | undefined;
  let cmsRepoHeader: string | undefined;
  let chapterFilters: string | null = null;
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const isCollection = new URL(route.request().url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      route.request().method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      route.request().method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Kody Test", enabled: true }],
    }),
  );
  await page.route("**/api/kody/cms/courses**", (route) => {
    cmsOwnerHeader = route.request().headers()["x-kody-owner"];
    cmsRepoHeader = route.request().headers()["x-kody-repo"];
    return json(route, {
      docs: [
        { id: "course-1", title: "Algebra" },
        { id: "course-2", title: "Geometry" },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    });
  });
  await page.route("**/api/kody/cms/chapters**", (route) => {
    chapterFilters = new URL(route.request().url()).searchParams.get("filters");
    return json(route, {
      docs: [{ id: "chapter-1", title: "Linear equations" }],
      total: 1,
      limit: 100,
      offset: 0,
    });
  });
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "GET") {
      return json(route, {
        definitions: [
          {
            id: "cms-selection",
            title: "CMS selection",
            source: "custom",
            steps: [{ rendererSlug: "selection-list" }],
          },
        ],
      });
    }
    const body = route.request().postDataJSON() as {
      action?: string;
      result?: { courseId?: unknown };
    };
    if (body.action === "submit") {
      selectedCourseId = body.result?.courseId ?? null;
      return json(route, {
        instance: { status: "active" },
        flow: {
          id: "cms-selection",
          title: "CMS selection",
          stepIndex: 1,
          stepCount: 2,
        },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "cms-chapter-view",
          rendererSlug: "selection-list",
          rendererName: "Selection list",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "cms-selection-instance",
            stepId: "step-2",
            revision: 1,
          },
          dataSource: {
            type: "cms",
            collection: "chapters",
            labelField: "title",
            valueField: "id",
            resultField: "chapterId",
            filter: { field: "course", value: "course-1" },
          },
          ui: {
            type: "stack",
            children: [
              { type: "text", value: "Choose a chapter", variant: "title" },
              { type: "list", children: [] },
            ],
          },
          data: { title: "Choose a chapter", items: [] },
        },
      });
    }
    return json(
      route,
      {
        instance: { status: "active" },
        flow: {
          id: "cms-selection",
          title: "CMS selection",
          stepIndex: 0,
          stepCount: 1,
        },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "cms-selection-view",
          rendererSlug: "selection-list",
          rendererName: "Selection list",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "cms-selection-instance",
            stepId: "step-1",
            revision: 0,
          },
          dataSource: {
            type: "cms",
            collection: "courses",
            labelField: "title",
            valueField: "id",
            resultField: "courseId",
          },
          ui: {
            type: "stack",
            children: [
              { type: "text", value: "Choose a course", variant: "title" },
              { type: "list", children: [] },
            ],
          },
          data: { title: "Choose a course", items: [] },
        },
      },
      201,
    );
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Start CMS selection in Chat" })
    .click();

  await expect(page.getByRole("button", { name: "Algebra" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Geometry" })).toBeVisible();
  expect(cmsOwnerHeader).toBe("acme");
  expect(cmsRepoHeader).toBe("widgets");
  await page.getByRole("button", { name: "Algebra" }).click();
  await expect.poll(() => selectedCourseId).toBe("course-1");
  await expect(
    page.getByRole("button", { name: "Linear equations" }),
  ).toBeVisible();
  expect(chapterFilters).toBe(
    JSON.stringify({ course: { equals: "course-1" } }),
  );
});

test("runs onboarding manually and lets the user advance after completing each page", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "The existing mobile GuidedFlow launch renders in the hidden desktop chat instance.",
  );
  const view = ({
    id,
    stepId,
    revision,
    title,
    actionId,
    actionLabel,
    body = "Complete the task, then return to Chat.",
    actions = [
      { id: actionId, label: actionLabel, variant: "primary" as const },
    ],
  }: {
    id: string;
    stepId: string;
    revision: number;
    title: string;
    actionId: string;
    actionLabel: string;
    body?: string;
    actions?: readonly {
      id: string;
      label: string;
      variant: "primary" | "secondary";
    }[];
  }) => ({
    action: "render_view",
    view: "renderer",
    id,
    rendererSlug: "approval-card",
    rendererName: "Approval card",
    resultTarget: "guided-flow",
    guidedFlow: {
      instanceId: "onboarding-instance",
      stepId,
      revision,
    },
    ui: {
      type: "stack",
      children: [
        { type: "text", value: title, variant: "title" },
        { type: "markdown", value: body },
        {
          type: "row",
          children: [
            ...actions.map((action) => ({
              type: "button",
              label: action.label,
              action: {
                id: action.id,
                label: action.label,
                response: action.id,
                variant: action.variant,
              },
            })),
          ],
        },
      ],
    },
    data: { title },
  });

  await page.route("**/api/kody/chat/conversations**", (route) => {
    const isCollection = new URL(route.request().url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      route.request().method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      route.request().method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [
        { id: "openrouter/free", label: "OpenRouter Free", enabled: true },
      ],
    }),
  );
  await page.route("**/api/kody/orgs/**/repos", (route) =>
    json(route, { organizations: ["acme"], repositories: [] }),
  );
  await page.route("**/api/kody/secrets", (route) =>
    json(route, { secrets: [] }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "GET") {
      return json(route, {
        definitions: [
          {
            id: "onboarding",
            title: "Get started with Kody",
            steps: [{ rendererSlug: "approval-card" }],
          },
        ],
        flows: [],
      });
    }

    const body = route.request().postDataJSON() as {
      action?: string;
      stepId?: string;
    };
    if (body.action === "start") {
      return json(
        route,
        {
          instance: { status: "active" },
          compatibility: { status: "compatible" },
          view: view({
            id: "onboarding-welcome-0",
            stepId: "welcome",
            revision: 0,
            title: "Welcome to Kody",
            actionId: "next",
            actionLabel: "Get started",
            body: "Create a GitHub PAT, connect a repository, then add `OPENROUTER_API_KEY`.\n\n- Complete each task in order.\n- Return to Chat and select **Next**.",
          }),
        },
        201,
      );
    }
    if (body.stepId === "welcome") {
      return json(route, {
        instance: { status: "active" },
        compatibility: { status: "compatible" },
        view: view({
          id: "onboarding-pat-1",
          stepId: "create-github-pat",
          revision: 1,
          title: "Create your GitHub PAT",
          actionId: "next",
          actionLabel: "Next",
          body: "**On GitHub:**\n\n1. [Create a personal access token](https://github.com/settings/tokens/new).\n2. Grant `repo`, `workflow`, and `admin:repo_hook`.\n3. Copy the token for the next step.",
        }),
      });
    }
    if (body.stepId === "create-github-pat") {
      return json(route, {
        instance: { status: "active" },
        compatibility: { status: "compatible" },
        view: view({
          id: "onboarding-repository-2",
          stepId: "connect-repository",
          revision: 2,
          title: "Connect your first repository",
          actionId: "next",
          actionLabel: "Next",
          body: "Enter the repository URL, paste your PAT, and select **Connect repository**.\n\nBefore connecting, grant **Webhooks: Read and write** on a fine-grained token, or `admin:repo_hook` on a classic token.",
        }),
        navigation: {
          action: "dashboard_navigate",
          routeId: "org",
          href: "/org",
          label: "Org",
          reason: "Open Connect a repository",
        },
      });
    }
    if (body.stepId === "choose-chat-provider") {
      return json(route, {
        instance: { status: "active" },
        compatibility: { status: "compatible" },
        view: view({
          id: "onboarding-xkiro-4",
          stepId: "add-xkiro-key",
          revision: 4,
          title: "Activate xKiro Free",
          actionId: "next",
          actionLabel: "Continue",
          body: "Add `XKIRO_API_KEY` on the Secrets page.",
        }),
        navigation: {
          action: "dashboard_navigate",
          routeId: "secrets",
          href: "/secrets",
          label: "Secrets",
          reason: "Open Add your xKiro key",
        },
      });
    }
    return json(route, {
      instance: { status: "active" },
      compatibility: { status: "compatible" },
      view: view({
        id: "onboarding-provider-choice-3",
        stepId: "choose-chat-provider",
        revision: 3,
        title: "Set up Chat",
        actionId: "openrouter",
        actionLabel: "Set up OpenRouter",
        actions: [
          { id: "openrouter", label: "Set up OpenRouter", variant: "primary" },
          { id: "xkiro", label: "Set up xKiro", variant: "secondary" },
          { id: "skip", label: "Skip for now", variant: "secondary" },
        ],
      }),
    });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Start Get started with Kody in Chat" })
    .click();
  const markdownCode = page.getByText("OPENROUTER_API_KEY", { exact: true });
  await expect(markdownCode).toBeVisible();
  await expect(markdownCode).toHaveJSProperty("tagName", "CODE");
  const markdown = markdownCode.locator(
    "xpath=ancestor::div[contains(@class, 'prose')][1]",
  );
  expect(
    await markdown.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  await expect(markdown.getByRole("list")).toBeVisible();
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  const chat = page.locator('[aria-label="Kody chat"]');
  await expect(
    chat.getByRole("heading", { name: "Create your GitHub PAT" }),
  ).toBeVisible();
  await expect(
    chat.getByRole("link", { name: "Create a personal access token" }),
  ).toHaveAttribute("href", "https://github.com/settings/tokens/new");
  await expect(page).toHaveURL(/\/repo\/acme\/widgets\/chat\/.+/);
  await chat.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL("/org/acme");
  await expect(
    page.getByRole("heading", { name: "Attached repositories" }),
  ).toBeVisible();
  await expect(
    chat.getByText("Webhooks: Read and write", { exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByText("admin:repo_hook", { exact: true }).last(),
  ).toBeVisible();

  await page
    .locator('[aria-label="Kody chat"]')
    .getByRole("button", { name: "Next", exact: true })
    .last()
    .click();
  await expect(
    chat.getByRole("heading", { name: "Set up Chat" }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Set up OpenRouter", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Set up xKiro", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByRole("button", { name: "Skip for now", exact: true }),
  ).toBeVisible();
  await chat.getByRole("button", { name: "Set up xKiro", exact: true }).click();
  await expect(page).toHaveURL("/repo/acme/widgets/secrets");
  await expect(
    page.getByText("Activate xKiro Free", { exact: true }),
  ).toBeVisible();
});

test("starts or resumes an unfinished GuidedFlow in Chat", async ({ page }) => {
  let startAttempts = 0;
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      request.method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Kody Test", enabled: true }],
    }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "POST") {
      startAttempts += 1;
      const body = route.request().postDataJSON() as {
        flowId?: string;
        conversationId?: string;
      };
      expect(body).toMatchObject({
        flowId: "addition-exercise",
      });
      expect(body.conversationId).toBeTruthy();
      return json(route, {
        instance: { status: "active" },
        flow: {
          id: "addition-exercise",
          title: "Addition exercise",
          stepIndex: 0,
          stepCount: 2,
        },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: "unfinished-instance-step-1",
          rendererSlug: "selection-list",
          rendererName: "Selection list",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "unfinished-instance",
            stepId: "question",
            revision: 1,
          },
          ui: {
            type: "stack",
            children: [
              {
                type: "text",
                value: "What is 2 + 2?",
                variant: "title",
              },
            ],
          },
          data: { title: "What is 2 + 2?" },
        },
      });
    }
    return json(route, {
      definitions: [
        {
          id: "addition-exercise",
          title: "Addition exercise",
          steps: [{ rendererSlug: "selection-list" }],
        },
      ],
      flows: [
        {
          instance: {
            instanceId: "unfinished-instance",
            revision: 1,
            status: "active",
          },
          compatibility: { status: "compatible" },
          flow: {
            title: "Addition exercise",
            stepIndex: 0,
            stepCount: 2,
          },
          view: {
            action: "render_view",
            view: "renderer",
            id: "unfinished-instance-step-1",
            rendererSlug: "selection-list",
            rendererName: "Selection list",
            resultTarget: "guided-flow",
            guidedFlow: {
              instanceId: "unfinished-instance",
              stepId: "question",
              revision: 1,
            },
            ui: {
              type: "stack",
              children: [
                {
                  type: "text",
                  value: "What is 2 + 2?",
                  variant: "title",
                },
              ],
            },
            data: { title: "What is 2 + 2?" },
          },
        },
      ],
    });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  const resume = page.getByRole("button", {
    name: "Start Addition exercise in Chat",
    exact: true,
  });
  await expect(resume).toBeVisible();

  await resume.click();
  await expect(page.getByText("What is 2 + 2?", { exact: true })).toBeVisible();
  await expect(page.getByText("What is 2 + 2?", { exact: true })).toHaveCount(
    1,
  );
  await expect.poll(() => startAttempts).toBe(1);
});

test("dispatches an enabled Back control through the GuidedFlow API", async ({
  page,
}) => {
  let controlRequest: Record<string, unknown> | null = null;
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      request.method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Kody Test", enabled: true }],
    }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.action === "control") controlRequest = body;

      const returnedToPreviousStep = body.action === "control";
      return json(route, {
        instance: { status: "active" },
        flow: {
          id: "review-release",
          title: "Review release",
          stepIndex: returnedToPreviousStep ? 0 : 1,
          stepCount: 2,
        },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: returnedToPreviousStep ? "review-step-1" : "review-step-2",
          rendererSlug: "approval-card",
          rendererName: "Approval card",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "review-instance",
            stepId: returnedToPreviousStep ? "review" : "confirm",
            revision: returnedToPreviousStep ? 4 : 3,
          },
          ui: returnedToPreviousStep
            ? {
                type: "text",
                value: "Review the release details",
                variant: "title",
              }
            : {
                type: "stack",
                children: [
                  {
                    type: "text",
                    value: "Confirm the release",
                    variant: "title",
                  },
                  {
                    type: "button",
                    label: "Back",
                    action: {
                      id: "guided-flow-control-back",
                      label: "Back",
                      response: "back",
                      variant: "secondary",
                      dispatch: { type: "control", id: "back" },
                    },
                  },
                ],
              },
          data: {},
        },
      });
    }

    return json(route, {
      definitions: [
        {
          id: "review-release",
          title: "Review release",
          steps: [{ rendererSlug: "approval-card" }],
        },
      ],
      flows: [
        {
          instance: {
            instanceId: "review-instance",
            revision: 3,
            status: "active",
          },
          compatibility: { status: "compatible" },
          flow: { title: "Review release", stepIndex: 1, stepCount: 2 },
          view: {},
        },
      ],
    });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Start Review release in Chat", exact: true })
    .click();
  await expect(page.getByText("Confirm the release")).toBeVisible();

  await page.getByRole("button", { name: "Back", exact: true }).click();

  await expect(page.getByText("Review the release details")).toBeVisible();
  await expect
    .poll(() => controlRequest)
    .toMatchObject({
      action: "control",
      controlId: "back",
      instanceId: "review-instance",
      expectedRevision: 3,
    });
});

test("lets the user choose between multiple active GuidedFlows", async ({
  page,
}) => {
  let selectedFlowId = "";
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const isCollection = new URL(request.url()).pathname.endsWith(
      "/conversations",
    );
    return json(
      route,
      request.method() === "GET" && isCollection
        ? { conversations: [] }
        : { ok: true },
      request.method() === "POST" && isCollection ? 201 : 200,
    );
  });
  await page.route("**/api/kody/models*", (route) =>
    json(route, {
      models: [{ id: "test/model", label: "Kody Test", enabled: true }],
    }),
  );
  await page.route("**/api/kody/guided-flows**", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        flowId?: string;
      };
      selectedFlowId = body.flowId ?? "";
      return json(route, {
        instance: { status: "active" },
        compatibility: { status: "compatible" },
        view: {
          action: "render_view",
          view: "renderer",
          id: `${selectedFlowId}-view`,
          rendererSlug: "selection-list",
          rendererName: "Selection list",
          resultTarget: "guided-flow",
          guidedFlow: {
            instanceId: "exercise-instance",
            stepId: "question",
            revision: 1,
          },
          ui: {
            type: "stack",
            children: [
              {
                type: "text",
                value:
                  selectedFlowId === "power-basics"
                    ? "Lesson question"
                    : "Exercise question",
                variant: "title",
              },
            ],
          },
          data: {},
        },
      });
    }
    return json(route, {
      definitions: [
        {
          id: "power-basics",
          title: "Power basics",
          steps: [{ rendererSlug: "selection-list" }],
        },
        {
          id: "addition-exercise",
          title: "Addition exercise",
          steps: [{ rendererSlug: "selection-list" }],
        },
      ],
      flows: [
        {
          instance: {
            instanceId: "lesson-instance",
            revision: 3,
            status: "active",
          },
          flow: { title: "Power basics", stepIndex: 2, stepCount: 6 },
          compatibility: { status: "compatible" },
          view: {},
        },
        {
          instance: {
            instanceId: "exercise-instance",
            revision: 1,
            status: "active",
          },
          flow: { title: "Addition exercise", stepIndex: 0, stepCount: 2 },
          compatibility: { status: "compatible" },
          view: {},
        },
      ],
    });
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Start Power basics in Chat" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start Addition exercise in Chat" })
    .click();

  await expect(page.getByText("Exercise question")).toBeVisible();
  expect(selectedFlowId).toBe("addition-exercise");
});

test("provides step editing controls, preview, and validation", async ({
  page,
}) => {
  await page.route("**/api/kody/guided-flows**", (route) =>
    json(route, { definitions: [] }),
  );
  await page.route("**/api/kody/cms/courses**", (route) =>
    json(route, {
      docs: [{ id: "course-1", title: "Algebra" }],
      total: 1,
      limit: 100,
      offset: 0,
    }),
  );
  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();

  const stepOneForm = page.getByLabel("Step form 1");
  await expect(
    stepOneForm.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Preview step 1")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const alignmentOffset = async (label: string) => {
      const stepCardBox = await page
        .getByLabel("Step 1: New step")
        .boundingBox();
      const comparedBox = await page.getByLabel(label).boundingBox();
      expect(stepCardBox).not.toBeNull();
      expect(comparedBox).not.toBeNull();
      return Math.abs((comparedBox?.y ?? 0) - (stepCardBox?.y ?? 0));
    };
    await expect.poll(() => alignmentOffset("Live preview 1")).toBeLessThan(24);
    await expect.poll(() => alignmentOffset("Preview step 1")).toBeLessThan(24);
    const previewCardBox = await page
      .getByLabel("Preview step 1")
      .boundingBox();
    expect(previewCardBox?.height ?? 999).toBeLessThan(260);
  }
  await page
    .getByLabel("Step 1 renderer", { exact: true })
    .selectOption("guided-form");
  await page
    .getByLabel("Step 1 instructions")
    .fill("**Ask** for the client sign-in details");
  await stepOneForm
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await expect(stepOneForm.getByText("Ask", { exact: true })).toHaveJSProperty(
    "tagName",
    "STRONG",
  );
  await stepOneForm.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByLabel("Preview step 1").getByLabel("Client ID"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Preview step 1").getByLabel("Client secret"),
  ).toBeVisible();
  await page
    .getByLabel("Step 1 renderer", { exact: true })
    .selectOption("selection-list");
  await page.getByLabel("Step 1 instructions").fill("Select course");
  await expect(
    page.getByLabel("Preview step 1").getByRole("button", { name: "Course 1" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Preview step 1").getByRole("button", { name: "Course 2" }),
  ).toBeVisible();
  await page.getByLabel("Step 1 choices source").selectOption("cms");
  await page.getByLabel("Step 1 collection").fill("courses");
  await page.getByLabel("Step 1 label field").fill("title");
  await page.getByLabel("Step 1 value field").fill("id");
  await page.getByLabel("Step 1 save selection as").fill("courseId");
  await expect(
    page.getByLabel("Preview step 1").getByRole("button", { name: "Algebra" }),
  ).toBeVisible();
  await page.getByLabel("Step 1 type", { exact: true }).selectOption("command");
  await expect(page.getByLabel("Step 1 command", { exact: true })).toHaveValue(
    "/init",
  );
  await page
    .getByLabel("Step 1 command", { exact: true })
    .fill("/init --force");
  await expect(
    page
      .getByLabel("Preview step 1")
      .getByRole("button", { name: "Run command" }),
  ).toBeVisible();
  await expect(page.getByLabel("Preview step 1")).toContainText(
    "/init --force",
  );
  await expect(
    page.getByRole("button", { name: "Move step 1 up" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete step 1" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "+ Add step" }).click();
  await page
    .getByLabel("Step 2 renderer", { exact: true })
    .selectOption("approval-card");
  await page
    .getByLabel("Step 2 instructions")
    .fill("Ask user for confirm, decline, edit, redo");
  for (const action of ["Confirm", "Decline", "Edit", "Redo"]) {
    await expect(
      page.getByLabel("Preview step 2").getByRole("button", { name: action }),
    ).toBeVisible();
  }
  await expect(page.getByLabel("Preview step 1")).toBeVisible();
  await expect(page.getByLabel("Preview step 2")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move step 2 up" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Move step 2 up" }).click();
  await page.getByRole("button", { name: "Duplicate step 1" }).click();
  await expect(
    page.getByRole("button", { name: "Delete step 3" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save Guided Flow" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a flow name.");
});

test("creates a GuidedFlow template with an explicit renderer", async ({
  page,
}) => {
  const posts: unknown[] = [];
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { definitions: [] });
      return;
    }
    posts.push(route.request().postDataJSON());
    await json(
      route,
      {
        definition: {
          id: "review-release",
          title: "Review a release",
          steps: [{ rendererSlug: "approval-card" }],
        },
      },
      201,
    );
  });
  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Flow name").fill("Review a release");
  await page.getByLabel("Enable Back control").check();
  await page.getByLabel("Step 1 title").fill("Confirm the release");
  await page
    .getByLabel("Step 1 instructions")
    .fill("Check the release details.");
  await page
    .getByLabel("Step 1 renderer", { exact: true })
    .selectOption("approval-card");
  await page
    .getByLabel("Completion page")
    .selectOption({ label: "Task detail" });
  await page.getByLabel("Completion page Task number").fill("42");
  await page.getByLabel("Step 1 page").selectOption({ label: "Findings" });
  await expect(
    page.getByPlaceholder("Dashboard page ID (optional)"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save Guided Flow" }).click();
  await expect(
    page.getByText("Review a release", { exact: true }),
  ).toBeVisible();
  expect(posts).toContainEqual({
    action: "create-definition",
    draft: expect.objectContaining({
      title: "Review a release",
      completionRouteId: "task",
      completionRouteParameters: { issueNumber: "42" },
      controls: ["back"],
      steps: expect.arrayContaining([
        expect.objectContaining({ routeId: "findings" }),
      ]),
    }),
  });
});

test("configures a Guide step to choose a file without changing ordinary Files", async ({
  page,
}) => {
  const posts: unknown[] = [];
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { definitions: [] });
      return;
    }
    posts.push(route.request().postDataJSON());
    await json(
      route,
      {
        definition: {
          id: "lesson-from-pdf",
          title: "Lesson from PDF",
          steps: [{ rendererSlug: "guided-form" }],
        },
      },
      201,
    );
  });
  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();
  await page.getByLabel("Flow name").fill("Lesson from PDF");
  await page.getByLabel("Step 1 title").fill("Select PDF");
  await page.getByLabel("Step 1 instructions").fill("Choose the lesson PDF.");
  await page.getByLabel("Step 1 page").selectOption({ label: "Files" });
  await page.getByLabel("Step 1 choose a file").check();
  await page.getByLabel("Step 1 file result field").fill("pdfPath");
  await page.getByLabel("Step 1 allowed file extensions").fill(".pdf");
  await page.getByRole("button", { name: "Save Guided Flow" }).click();

  expect(posts).toContainEqual({
    action: "create-definition",
    draft: expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({
          routeId: "files",
          filePicker: { resultField: "pdfPath", extensions: [".pdf"] },
        }),
      ]),
    }),
  });
});

test("adds a widget through the existing GuidedFlow view-step model", async ({
  page,
}) => {
  const posts: unknown[] = [];
  await page.route("**/api/kody/widgets/question-select?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export default function mount(element) { element.textContent = 'Question widget preview'; }",
    }),
  );
  await page.route("**/api/kody/view-renderers", (route) =>
    json(route, {
      renderers: [
        {
          slug: "question-select",
          name: "Question select",
          version: 4,
          source: "repo",
          type: "layout",
          data: { question: { type: "json" } },
          ui: {
            type: "widget",
            widget: "question-select",
            version: 7,
            data: "$question",
          },
        },
      ],
    }),
  );
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, { definitions: [] });
      return;
    }
    posts.push(route.request().postDataJSON());
    await json(
      route,
      {
        definition: {
          id: "question-flow",
          version: 1,
          title: "Question flow",
          steps: [{ rendererSlug: "question-select" }],
        },
      },
      201,
    );
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();
  await page.getByLabel("Flow name").fill("Question flow");
  await page.getByLabel("Step 1 title").fill("Answer the question");
  await page.getByLabel("Step 1 instructions").fill("Choose one answer.");
  await page.getByLabel("Step 1 type").selectOption("widget");
  await page
    .getByLabel("Step 1 widget", { exact: true })
    .selectOption("question-select");
  await page
    .getByLabel("Step 1 widget input")
    .fill('{"question":{"questionId":"question-1"}}');
  await page.getByLabel("Step 1 completion action").fill("correct");
  await page.getByRole("button", { name: "Save Guided Flow" }).click();

  await expect(page.getByText("Question flow", { exact: true })).toBeVisible();
  expect(posts).toContainEqual({
    action: "create-definition",
    draft: {
      title: "Question flow",
      completionRouteId: "",
      controls: [],
      steps: [
        {
          title: "Answer the question",
          explanation: "Choose one answer.",
          rendererSlug: "question-select",
          rendererVersion: 4,
          rendererDataJson: '{"question":{"questionId":"question-1"}}',
          completionActionId: "correct",
        },
      ],
    },
  });
});

test("creates a GuidedFlow that calls another flow", async ({ page }) => {
  const posts: unknown[] = [];
  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, {
        definitions: [
          {
            id: "child-flow",
            version: 2,
            title: "Child flow",
            steps: [],
          },
          {
            id: "other-flow",
            version: 4,
            title: "Other flow",
            steps: [],
          },
        ],
      });
      return;
    }
    posts.push(route.request().postDataJSON());
    await json(
      route,
      {
        definition: {
          id: "parent-flow",
          version: 1,
          title: "Parent flow",
          steps: [
            {
              id: "step-1",
              type: "flow",
              title: "Run child",
              explanation: "Complete the child flow.",
              flowId: "child-flow",
              flowVersion: 2,
            },
          ],
        },
      },
      201,
    );
  });
  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Add Guided Flow", exact: true })
    .click();
  await page.getByLabel("Flow name").fill("Parent flow");
  await page.getByLabel("Step 1 title").fill("Run child");
  await page.getByLabel("Step 1 instructions").fill("Complete the child flow.");
  await page.getByLabel("Step 1 type").selectOption("flow");
  await page
    .getByLabel("Step 1 nested flow")
    .selectOption({ label: "Child flow · v2" });
  await expect(page.getByLabel("Step 1 flow ID")).toHaveCount(0);
  await expect(page.getByLabel("Step 1 flow version")).toHaveCount(0);
  await page.getByRole("button", { name: "Save Guided Flow" }).click();

  await expect(page.getByText("Parent flow", { exact: true })).toBeVisible();
  expect(posts).toContainEqual({
    action: "create-definition",
    draft: {
      title: "Parent flow",
      completionRouteId: "",
      controls: [],
      steps: [
        {
          type: "flow",
          title: "Run child",
          explanation: "Complete the child flow.",
          flowId: "child-flow",
          flowVersion: 2,
        },
      ],
    },
  });
});

test("manages custom GuidedFlow definitions without editing built-ins", async ({
  page,
}) => {
  const posts: unknown[] = [];
  let customDefinition = {
    id: "review-release",
    title: "Review a release",
    version: 1,
    description: "Review the release before publishing.",
    steps: [
      {
        title: "Confirm release",
        explanation: "Check the details.",
        rendererSlug: "approval-card",
      },
    ],
  };

  await page.route("**/api/kody/guided-flows**", async (route) => {
    if (route.request().method() === "GET") {
      await json(route, {
        definitions: [
          {
            id: "create-workflow",
            title: "Create a workflow",
            steps: [
              {
                title: "Describe the workflow",
                explanation: "Use **Markdown** instructions.",
                rendererSlug: "guided-form",
              },
            ],
          },
          customDefinition,
        ],
      });
      return;
    }

    const body = route.request().postDataJSON() as {
      action: string;
      draft?: { title: string };
      flowId?: string;
    };
    posts.push(body);
    if (body.action === "update-definition") {
      customDefinition = {
        ...customDefinition,
        title: body.draft?.title ?? customDefinition.title,
        version: customDefinition.version + 1,
      };
      await json(route, { definition: customDefinition });
      return;
    }
    if (body.action === "delete-definition") {
      await json(route, { deleted: body.flowId });
      return;
    }
    await json(route, { error: "unexpected_action" }, 400);
  });

  await page.goto("/repo/acme/widgets/guided-flows", {
    waitUntil: "domcontentloaded",
  });
  const builtIn = page.getByRole("article", { name: "Create a workflow" });
  const custom = page.getByRole("article", { name: "Review a release" });
  await expect(builtIn).toBeVisible();
  await expect(custom).toBeVisible();
  await expect(builtIn.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(custom.getByRole("button", { name: "Edit" })).toBeVisible();

  await builtIn.getByRole("button", { name: "View" }).click();
  const viewDialog = page.getByRole("dialog", { name: "View Guided Flow" });
  await expect(viewDialog).toBeVisible();
  await expect(viewDialog.getByLabel("Flow name")).toBeDisabled();
  await expect(viewDialog.getByLabel("Step 1 instructions")).toHaveCount(0);
  await expect(
    viewDialog.getByText("Markdown", { exact: true }).first(),
  ).toHaveJSProperty("tagName", "STRONG");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close" })
    .first()
    .click();

  await custom.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit Guided Flow" });
  await editDialog.getByLabel("Flow name").fill("Review a production release");
  await editDialog.getByRole("button", { name: "Save Guided Flow" }).click();
  await expect(
    page.getByRole("article", { name: "Review a production release" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Review a production release" })
      .getByText("v2", { exact: true }),
  ).toBeVisible();
  expect(posts).toContainEqual({
    action: "update-definition",
    flowId: "review-release",
    draft: expect.objectContaining({ title: "Review a production release" }),
  });

  await page
    .getByRole("article", { name: "Review a production release" })
    .getByRole("button", { name: "Delete" })
    .click();
  const confirmDialog = page.getByRole("dialog", {
    name: "Delete Guided Flow",
  });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete" }).click();
  await expect(confirmDialog).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Review a production release" }),
  ).toHaveCount(0);
  expect(posts).toContainEqual({
    action: "delete-definition",
    flowId: "review-release",
  });
});
